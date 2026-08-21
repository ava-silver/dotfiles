import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi");
const LEGACY_LEDGER_FILES = [join(CACHE_DIR, "spend-v1.jsonl"), join(CACHE_DIR, "spend-v2.jsonl")];
const IMPORT_CONCURRENCY = 8;
const IMPORT_RETRIES = 3;
const GRAPH_FILE = join(CACHE_DIR, "spend.html");
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_TIMESTAMP = Date.UTC(2100, 0, 1);
const MIN_MODEL_COST = 1;

type SpendKind = "assistant" | "tool" | "compaction" | "branch_summary";

export type SpendRecord = {
	v: 3;
	key: string;
	kind: SpendKind;
	entryId: string;
	sessionId: string;
	cwd?: string;
	timestamp: number;
	provider: string;
	model: string;
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

type SessionFile = { id: string; cwd?: string };
export function recordKey(kind: SpendKind, entryId: string, timestamp: number): string {
	return `${kind}:${entryId}:${timestamp}`;
}

export function isValidTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= MIN_TIMESTAMP && value <= MAX_TIMESTAMP;
}

export function asRecord(entry: any, session: SessionFile): SpendRecord | undefined {
	if (typeof entry?.id !== "string" || !entry.id) return;

	let kind: SpendKind;
	let usage;
	let timestamp: number;
	let provider = "Tools";
	let model = "summaries";
	if (entry.type === "message" && entry.message?.role === "assistant") {
		const message = entry.message as AssistantMessage;
		kind = "assistant";
		usage = message.usage;
		timestamp = message.timestamp;
		provider = message.provider || "unknown";
		model = message.responseModel || message.model || "unknown";
	} else if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
		kind = "tool";
		usage = entry.message.usage;
		timestamp = entry.message.timestamp;
	} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
		kind = entry.type;
		usage = entry.usage;
		timestamp = Date.parse(entry.timestamp);
	} else {
		return;
	}

	const cost = usage?.cost?.total;
	if (!isValidTimestamp(timestamp) || !Number.isFinite(cost)) return;

	return {
		v: 3,
		key: recordKey(kind, entry.id, timestamp),
		kind,
		entryId: entry.id,
		sessionId: session.id,
		...(session.cwd === undefined ? {} : { cwd: session.cwd }),
		timestamp,
		provider,
		model,
		cost,
		input: usage.input || 0,
		output: usage.output || 0,
		cacheRead: usage.cacheRead || 0,
		cacheWrite: usage.cacheWrite || 0,
	};
}

async function sessionFiles(root: string, concurrency: number): Promise<string[]> {
	const files: string[] = [];
	let directories = [root];
	while (directories.length > 0) {
		const entries = await mapBounded(directories, concurrency, async (directory) => {
			try {
				return { directory, entries: await readdir(directory, { withFileTypes: true }) };
			} catch {
				return { directory, entries: [] };
			}
		});
		directories = [];
		for (const { directory, entries: children } of entries) {
			for (const entry of children) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) directories.push(path);
				else if (entry.isFile() && path.endsWith(".jsonl")) files.push(path);
			}
		}
	}
	return files;
}

export type SessionMetadata = { size: number; mtimeMs: number };
type ParsedSession = { records: SpendRecord[]; metadata: SessionMetadata };
type SessionIndex = Record<string, SessionMetadata>;

type SessionReader = (path: string) => Promise<string>;
type SessionStatter = (path: string) => Promise<SessionMetadata>;

async function fileMetadata(path: string): Promise<SessionMetadata> {
	const info = await stat(path);
	return { size: info.size, mtimeMs: info.mtimeMs };
}

function sameMetadata(left: SessionMetadata, right: SessionMetadata): boolean {
	return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function parseSessionText(text: string): SpendRecord[] | undefined {
	const lines = text.split("\n");
	let finalLine: string | undefined;
	for (let index = lines.length - 1; index >= 0; index--) {
		if (lines[index]) {
			finalLine = lines[index];
			break;
		}
	}
	if (!finalLine) return;
	try {
		JSON.parse(finalLine);
	} catch {
		return;
	}

	let session: SessionFile | undefined;
	const records: SpendRecord[] = [];
	for (const line of lines) {
		if (!line) continue;
		try {
			const entry: unknown = JSON.parse(line);
			if (typeof entry !== "object" || entry === null) continue;
			const candidate = entry as { type?: unknown; id?: unknown; cwd?: unknown };
			if (candidate.type === "session" && typeof candidate.id === "string" && candidate.id) {
				session = { id: candidate.id, ...(typeof candidate.cwd === "string" ? { cwd: candidate.cwd } : {}) };
			} else if (session) {
				const record = asRecord(entry, session);
				if (record) records.push(record);
			}
		} catch {
			// Malformed interior lines do not prevent subsequent imports.
		}
	}
	return session ? records : undefined;
}

export async function parseStableSession(
	path: string,
	{
		read = (file) => readFile(file, "utf8"),
		getMetadata = fileMetadata,
		retries = IMPORT_RETRIES,
	}: { read?: SessionReader; getMetadata?: SessionStatter; retries?: number } = {},
): Promise<ParsedSession | undefined> {
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const before = await getMetadata(path);
			const records = parseSessionText(await read(path));
			const after = await getMetadata(path);
			if (records && sameMetadata(before, after)) return { records, metadata: before };
		} catch {
			// Deleted files and concurrent replacements are retried or ignored.
		}
	}
}

export async function mapBounded<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await map(items[index]!);
			}
		}),
	);
	return results;
}

function parseIndex(text: string): SessionIndex | undefined {
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null) return;
		const sessions = (value as { sessions?: unknown }).sessions;
		if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) return;
		return Object.fromEntries(
			Object.entries(sessions).flatMap(([path, metadata]) => {
				if (typeof metadata !== "object" || metadata === null) return [];
				const { size, mtimeMs } = metadata as { size?: unknown; mtimeMs?: unknown };
				return typeof size === "number" &&
					Number.isFinite(size) &&
					typeof mtimeMs === "number" &&
					Number.isFinite(mtimeMs)
					? [[path, { size, mtimeMs }]]
					: [];
			}),
		);
	} catch {
		return;
	}
}

export function parseLedgerRecord(value: unknown): SpendRecord | undefined {
	if (typeof value !== "object" || value === null) return;
	const candidate = value as { [key: string]: unknown };
	const { sessionId, key, timestamp, provider, model, cost, input, output, cacheRead, cacheWrite } = candidate;
	if (
		(Object.hasOwn(candidate, "cwd") && typeof candidate.cwd !== "string") ||
		typeof sessionId !== "string" ||
		!sessionId ||
		typeof key !== "string" ||
		!key ||
		!isValidTimestamp(timestamp) ||
		typeof provider !== "string" ||
		typeof model !== "string" ||
		typeof cost !== "number" ||
		!Number.isFinite(cost) ||
		typeof input !== "number" ||
		!Number.isFinite(input) ||
		typeof output !== "number" ||
		!Number.isFinite(output) ||
		typeof cacheRead !== "number" ||
		!Number.isFinite(cacheRead) ||
		typeof cacheWrite !== "number" ||
		!Number.isFinite(cacheWrite)
	)
		return;

	let kind: SpendKind = "assistant";
	let entryId: string;
	if (candidate.v === 3) {
		if (
			(candidate.kind !== "assistant" &&
				candidate.kind !== "tool" &&
				candidate.kind !== "compaction" &&
				candidate.kind !== "branch_summary") ||
			typeof candidate.entryId !== "string" ||
			!candidate.entryId
		)
			return;
		kind = candidate.kind;
		entryId = candidate.entryId;
		if (key !== recordKey(kind, entryId, timestamp)) return;
	} else if (candidate.v === 2 && key.startsWith(`${sessionId}:`)) {
		entryId = key.slice(sessionId.length + 1);
		if (!entryId) return;
	} else if (candidate.v === 1) {
		entryId = key;
	} else {
		return;
	}

	return {
		v: 3,
		key: recordKey(kind, entryId, timestamp),
		kind,
		entryId,
		sessionId,
		...(typeof candidate.cwd === "string" ? { cwd: candidate.cwd } : {}),
		timestamp,
		provider,
		model,
		cost,
		input,
		output,
		cacheRead,
		cacheWrite,
	};
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function summary(records: Iterable<SpendRecord>): string {
	const unique = new Map<string, SpendRecord>();
	for (const record of records) unique.set(record.key, record);
	const all = [...unique.values()];
	const total = all.reduce((sum, record) => sum + record.cost, 0);
	const byModel = new Map<string, number>();
	const bySession = new Map<string, number>();
	for (const record of all) {
		const model = `${record.provider}/${record.model}`;
		byModel.set(model, (byModel.get(model) || 0) + record.cost);
		const session = `${record.sessionId.slice(0, 8)} ${basename(record.cwd || "unknown")}`;
		bySession.set(session, (bySession.get(session) || 0) + record.cost);
	}
	const top = (items: Map<string, number>) =>
		[...items]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([name, cost]) => `  ${formatCost(cost)}  ${name}`);
	return [
		`Pi spend: ${formatCost(total)} across ${bySession.size} sessions (${all.length} responses)`,
		"By model:",
		...top(new Map([...byModel].filter(([, cost]) => cost >= MIN_MODEL_COST))),
		"By session:",
		...top(bySession),
	].join("\n");
}

export function graphHtml(records: Iterable<SpendRecord>): string {
	const unique = new Map<string, SpendRecord>();
	for (const record of records) unique.set(record.key, record);
	const all = [...unique.values()]
		.filter((record) => isValidTimestamp(record.timestamp))
		.sort((a, b) => a.timestamp - b.timestamp);
	const modelTotals = new Map<string, number>();
	for (const record of all) {
		const name = `${record.provider}/${record.model}`;
		modelTotals.set(name, (modelTotals.get(name) || 0) + record.cost);
	}
	const modelNames = [...modelTotals].filter(([, cost]) => cost >= MIN_MODEL_COST).map(([name]) => name);
	const observedDates = [...new Set(all.map((record) => new Date(record.timestamp).toISOString().slice(0, 10)))].sort();
	const dates: string[] = [];
	const firstObservedDate = observedDates[0];
	const lastObservedDate = observedDates.at(-1);
	if (firstObservedDate && lastObservedDate) {
		const cursor = new Date(`${firstObservedDate}T00:00:00Z`);
		const end = new Date(`${lastObservedDate}T00:00:00Z`);
		while (cursor <= end) {
			const day = cursor.getUTCDay();
			if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
	}

	const dateIndexes = new Map(dates.map((date, index) => [date, index]));
	const models = modelNames.map((name, modelIndex) => {
		const daily = Array(dates.length).fill(0) as number[];
		for (const record of all) {
			if (`${record.provider}/${record.model}` !== name) continue;
			const date = new Date(record.timestamp).toISOString().slice(0, 10);
			const index = dateIndexes.get(date);
			if (index !== undefined) daily[index] = (daily[index] ?? 0) + record.cost;
		}
		let running = 0;
		const cumulative = daily.map((cost) => (running += cost));
		return {
			name,
			color: `hsl(${(modelIndex * 137.508) % 360} 68% 58%)`,
			daily,
			cumulative,
		};
	});
	const data = {
		dates,
		models,
		total: all.reduce((sum, record) => sum + record.cost, 0),
		sessions: new Set(all.map((record) => record.sessionId)).size,
		responses: all.length,
	};
	const json = JSON.stringify(data).replace(/</g, "\\u003c");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pi spend</title>
<style>
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #111318; color: #e7e9ee; }
body { max-width: 1200px; margin: 0 auto; padding: 32px 24px 56px; }
h1 { margin: 0 0 24px; font-size: 28px; }
.summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
.card, .chart { background: #191c23; border: 1px solid #2a2f3a; border-radius: 12px; }
.card { min-width: 140px; padding: 14px 18px; }
.card strong { display: block; font-size: 22px; }
.card span { color: #939aaa; font-size: 13px; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 20px; color: #c4c8d2; font-size: 13px; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
.chart { padding: 18px; margin-top: 16px; }
.chart h2 { font-size: 16px; margin: 0 0 12px; }
canvas { display: block; width: 100%; height: 340px; }
.empty { color: #939aaa; padding: 80px 0; text-align: center; }
</style>
</head>
<body>
<h1>Pi spend</h1>
<div class="summary" id="summary"></div>
<div class="legend" id="legend"></div>
<div id="charts">
  <section class="chart"><h2>Daily spend by model</h2><canvas id="daily"></canvas></section>
  <section class="chart"><h2>Cumulative spend by model</h2><canvas id="cumulative"></canvas></section>
</div>
<script>
const data = ${json};
const money = value => '$' + value.toFixed(value >= 1 ? 2 : value >= .01 ? 3 : 4);
const summary = document.getElementById('summary');
for (const [value, label] of [[money(data.total), 'total'], [data.sessions, 'sessions'], [data.responses, 'responses']]) {
  const card = document.createElement('div');
  const strong = document.createElement('strong');
  const span = document.createElement('span');
  card.className = 'card';
  strong.textContent = String(value);
  span.textContent = label;
  card.append(strong, span);
  summary.append(card);
}
const legend = document.getElementById('legend');
for (const model of data.models) {
  const item = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.style.background = model.color;
  item.append(swatch, document.createTextNode(model.name));
  legend.append(item);
}

function draw(canvas, mode) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(340 * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const width = rect.width, height = 340;
  const plot = { left: 64, top: 14, right: width - 18, bottom: height - 38 };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = plot.bottom - plot.top;
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  ctx.lineWidth = 1;

  if (!data.dates.length) {
    ctx.fillStyle = '#939aaa';
    ctx.textAlign = 'center';
    ctx.fillText('No spend recorded yet', width / 2, height / 2);
    return;
  }

  const totals = data.dates.map((_, i) => data.models.reduce((sum, model) => sum + model.daily[i], 0));
  const values = mode === 'daily'
    ? totals
    : data.models.map(model => model.cumulative.at(-1) || 0);
  const max = Math.max(.0001, ...values);
  const y = value => plot.bottom - (value / max) * plotHeight;

  ctx.strokeStyle = '#303541';
  ctx.fillStyle = '#858c9c';
  ctx.textAlign = 'right';
  for (let tick = 0; tick <= 4; tick++) {
    const value = max * tick / 4;
    const yy = y(value);
    ctx.beginPath(); ctx.moveTo(plot.left, yy); ctx.lineTo(plot.right, yy); ctx.stroke();
    ctx.fillText(money(value), plot.left - 8, yy + 4);
  }

  const xTicks = Math.min(7, data.dates.length);
  ctx.textAlign = 'center';
  for (let tick = 0; tick < xTicks; tick++) {
    const index = xTicks === 1 ? 0 : Math.round(tick * (data.dates.length - 1) / (xTicks - 1));
    const x = plot.left + (index + .5) * plotWidth / data.dates.length;
    ctx.fillText(data.dates[index].slice(5), x, height - 14);
  }

  if (mode === 'daily') {
    const slot = plotWidth / data.dates.length;
    const barWidth = Math.max(1, Math.min(24, slot * .72));
    data.dates.forEach((_, index) => {
      let bottom = plot.bottom;
      data.models.forEach(model => {
        const barHeight = model.daily[index] / max * plotHeight;
        ctx.fillStyle = model.color;
        ctx.fillRect(plot.left + index * slot + (slot - barWidth) / 2, bottom - barHeight, barWidth, barHeight);
        bottom -= barHeight;
      });
    });
  } else {
    data.models.forEach(model => {
      ctx.strokeStyle = model.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      model.cumulative.forEach((value, index) => {
        const x = plot.left + (index + .5) * plotWidth / data.dates.length;
        const yy = y(value);
        index ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      });
      ctx.stroke();
    });
  }
}
function redraw() {
  draw(document.getElementById('daily'), 'daily');
  draw(document.getElementById('cumulative'), 'cumulative');
}
redraw();
window.addEventListener('resize', redraw);
</script>
</body>
</html>`;
}

export function parseLedger(text: string): SpendRecord[] {
	const records: SpendRecord[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		try {
			const record = parseLedgerRecord(JSON.parse(line));
			if (record) records.push(record);
		} catch {
			// Ignore malformed lines while retaining subsequent records.
		}
	}
	return records;
}

export function createSpendStore({
	cacheDir = CACHE_DIR,
	sessionsDir = SESSIONS_DIR,
	concurrency = IMPORT_CONCURRENCY,
	legacyLedgerFiles = LEGACY_LEDGER_FILES,
}: { cacheDir?: string; sessionsDir?: string; concurrency?: number; legacyLedgerFiles?: string[] } = {}) {
	const ledgerFile = join(cacheDir, "spend-v3.jsonl");
	const indexFile = join(cacheDir, "spend-v3-index.json");
	const records = new Map<string, SpendRecord>();
	let loading: Promise<void> | undefined;
	let saving = Promise.resolve();
	let importing: Promise<void> | undefined;
	let ledgerExists = false;
	let indexPresent = false;
	let index: SessionIndex | undefined;

	function loadLedger(): Promise<void> {
		if (loading) return loading;
		loading = (async () => {
			for (const file of [...legacyLedgerFiles, ledgerFile]) {
				try {
					const text = await readFile(file, "utf8");
					if (file === ledgerFile) ledgerExists = true;
					for (const record of parseLedger(text)) records.set(record.key, record);
				} catch {
					/* ignore missing or malformed cache entries */
				}
			}
			try {
				const text = await readFile(indexFile, "utf8");
				indexPresent = true;
				index = parseIndex(text);
			} catch {
				// An absent index is migrated below.
			}
		})();
		return loading;
	}

	function save(newRecords: SpendRecord[]): Promise<void> {
		const operation = saving.then(async () => {
			const fresh = new Map(
				newRecords.filter((record) => !records.has(record.key)).map((record) => [record.key, record]),
			);
			if (!fresh.size) return;
			await mkdir(cacheDir, { recursive: true });
			await appendFile(ledgerFile, [...fresh.values()].map((record) => JSON.stringify(record)).join("\n") + "\n");
			for (const [key, record] of fresh) records.set(key, record);
		});
		saving = operation.catch(() => undefined);
		return operation;
	}

	async function persistIndex(sessions: SessionIndex): Promise<void> {
		await mkdir(cacheDir, { recursive: true });
		const temporary = `${indexFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify({ v: 1, sessions }), { mode: 0o600 });
			await rename(temporary, indexFile);
		} finally {
			await unlink(temporary).catch(() => undefined);
		}
	}

	async function importChangedSessions(): Promise<void> {
		await loadLedger();
		const files = await sessionFiles(sessionsDir, concurrency);
		const metadata = await mapBounded(files, concurrency, async (file) => {
			try {
				return [file, await fileMetadata(file)] as const;
			} catch {
				return undefined;
			}
		});
		const current = Object.fromEntries(
			metadata.filter((entry): entry is readonly [string, SessionMetadata] => entry !== undefined),
		);
		if (!index && !indexPresent && ledgerExists) {
			index = current;
			await persistIndex(index);
			return;
		}

		const previous = index || {};
		const fileSet = new Set(files);
		const changed = files.filter(
			(file) => current[file] && !sameMetadata(previous[file] || { size: -1, mtimeMs: -1 }, current[file]),
		);
		const parsed = await mapBounded(changed, concurrency, (file) => parseStableSession(file));
		await save(parsed.flatMap((result) => result?.records || []));
		index = {
			...Object.fromEntries(Object.entries(previous).filter(([file]) => fileSet.has(file))),
			...Object.fromEntries(
				changed.flatMap((file, position) => {
					const result = parsed[position];
					return result ? [[file, result.metadata]] : [];
				}),
			),
		};
		await persistIndex(index);
	}

	function importSessions(): Promise<void> {
		if (importing) return importing;
		importing = importChangedSessions().finally(() => {
			importing = undefined;
		});
		return importing;
	}

	return { records, loadLedger, save, importSessions };
}

export default function spendExtension(pi: ExtensionAPI): void {
	const store = createSpendStore();

	pi.on("session_start", store.importSessions);

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant" && event.message.role !== "toolResult") return;
		await store.loadLedger();
		const entry = [...ctx.sessionManager.getEntries()]
			.reverse()
			.find(
				(candidate) =>
					candidate.type === "message" &&
					candidate.message.role === event.message.role &&
					candidate.message.timestamp === event.message.timestamp,
			);
		const header = ctx.sessionManager.getHeader();
		if (entry && header) {
			const record = asRecord(entry, { id: header.id, cwd: header.cwd });
			if (record) await store.save([record]);
		}
	});

	const saveCurrentSession = async (_event: unknown, ctx: ExtensionContext) => {
		await store.loadLedger();
		const file = ctx.sessionManager.getSessionFile();
		if (!file) return;
		const parsed = await parseStableSession(file);
		if (parsed) await store.save(parsed.records);
	};
	pi.on("session_compact", saveCurrentSession);
	pi.on("session_tree", saveCurrentSession);

	pi.registerCommand("spend", {
		description: "Open Pi spend graphs in the browser (use /spend text for the report)",
		handler: async (args, ctx) => {
			await store.importSessions();
			if (args.trim() === "text") {
				const report = summary(store.records.values());
				if (ctx.hasUI) await ctx.ui.editor("Pi spend", report);
				else console.log(report);
				return;
			}

			await mkdir(CACHE_DIR, { recursive: true });
			await writeFile(GRAPH_FILE, graphHtml(store.records.values()));
			const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
			const commandArgs = process.platform === "win32" ? ["/c", "start", "", GRAPH_FILE] : [GRAPH_FILE];
			const result = await pi.exec(command, commandArgs, { timeout: 5_000 });
			if (result.code !== 0) ctx.ui.notify(`Could not open ${GRAPH_FILE}`, "error");
		},
	});
}
