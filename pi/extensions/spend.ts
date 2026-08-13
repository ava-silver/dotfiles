import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi");
const LEGACY_LEDGER_FILE = join(CACHE_DIR, "spend-v1.jsonl");
const LEDGER_FILE = join(CACHE_DIR, "spend-v2.jsonl");
const GRAPH_FILE = join(CACHE_DIR, "spend.html");
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_TIMESTAMP = Date.UTC(2100, 0, 1);

export type SpendRecord = {
	v: 2;
	key: string;
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

type SessionFile = { path: string; id: string; cwd?: string };
export function recordKey(sessionId: string, entryId: string): string {
	return `${sessionId}:${entryId}`;
}

export function isValidTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= MIN_TIMESTAMP && value <= MAX_TIMESTAMP;
}

function asRecord(entry: any, session: SessionFile): SpendRecord | undefined {
	const message = entry?.message as AssistantMessage | undefined;
	if (
		entry?.type !== "message" ||
		typeof entry.id !== "string" ||
		!entry.id ||
		message?.role !== "assistant" ||
		!message.usage ||
		!isValidTimestamp(message.timestamp)
	)
		return;

	const cost = message.usage.cost?.total;
	if (!Number.isFinite(cost)) return;

	return {
		v: 2,
		key: recordKey(session.id, entry.id),
		sessionId: session.id,
		...(session.cwd === undefined ? {} : { cwd: session.cwd }),
		timestamp: message.timestamp,
		provider: message.provider || "unknown",
		model: message.model || "unknown",
		cost,
		input: message.usage.input || 0,
		output: message.usage.output || 0,
		cacheRead: message.usage.cacheRead || 0,
		cacheWrite: message.usage.cacheWrite || 0,
	};
}

async function sessionFiles(dir: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const children = await Promise.all(
		entries.map(async (entry) => {
			const path = join(dir, entry.name);
			return entry.isDirectory() ? sessionFiles(path) : entry.isFile() && path.endsWith(".jsonl") ? [path] : [];
		}),
	);
	return children.flat();
}

async function parseSession(path: string): Promise<{ session: SessionFile; records: SpendRecord[] } | undefined> {
	let lines: string[];
	try {
		lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
	} catch {
		return;
	}

	let session: SessionFile | undefined;
	const records: SpendRecord[] = [];
	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (entry.type === "session" && typeof entry.id === "string" && entry.id) {
				session = { path, id: entry.id, cwd: typeof entry.cwd === "string" ? entry.cwd : undefined };
			} else if (session) {
				const record = asRecord(entry, session);
				if (record) records.push(record);
			}
		} catch {
			// A partially written session line will be processed on the next run.
		}
	}
	return session ? { session, records } : undefined;
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

	const base = {
		v: 2 as const,
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
	if (candidate.v === 2 && key.startsWith(`${sessionId}:`)) return { ...base, key };
	if (candidate.v === 1) return { ...base, key: recordKey(sessionId, key) };
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
		...top(byModel),
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
	const modelNames = [...new Set(all.map((record) => `${record.provider}/${record.model}`))];
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

export default function spendExtension(pi: ExtensionAPI): void {
	const records = new Map<string, SpendRecord>();
	let initialized = false;

	async function loadLedger(): Promise<void> {
		if (initialized) return;
		initialized = true;
		try {
			for (const file of [LEGACY_LEDGER_FILE, LEDGER_FILE]) {
				try {
					for (const record of parseLedger(await readFile(file, "utf8"))) records.set(record.key, record);
				} catch {
					/* ignore missing or malformed cache entries */
				}
			}
		} catch {
			/* the ledger is created on first write */
		}
	}

	async function save(newRecords: SpendRecord[]): Promise<void> {
		const fresh = newRecords.filter((record) => !records.has(record.key));
		if (!fresh.length) return;
		await mkdir(CACHE_DIR, { recursive: true });
		await appendFile(LEDGER_FILE, fresh.map((record) => JSON.stringify(record)).join("\n") + "\n");
		for (const record of fresh) records.set(record.key, record);
	}

	async function importSessions(): Promise<void> {
		const files = await sessionFiles(SESSIONS_DIR);
		const parsed = await Promise.all(files.map(parseSession));
		await save(parsed.flatMap((result) => result?.records || []));
	}

	pi.on("session_start", async (_event, ctx) => {
		await loadLedger();
		const file = ctx.sessionManager.getSessionFile();
		if (file) {
			const parsed = await parseSession(file);
			if (parsed) await save(parsed.records);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		await loadLedger();
		const entries = ctx.sessionManager.getEntries();
		const entry = [...entries]
			.reverse()
			.find(
				(candidate: any) =>
					candidate.type === "message" &&
					candidate.message.role === "assistant" &&
					candidate.message.timestamp === event.message.timestamp,
			);
		const header = ctx.sessionManager.getHeader();
		if (entry && header) {
			const record = asRecord(entry, {
				path: ctx.sessionManager.getSessionFile() || "",
				id: header.id,
				cwd: header.cwd,
			});
			if (record) await save([record]);
		}
	});

	pi.registerCommand("spend", {
		description: "Open Pi spend graphs in the browser (use /spend text for the report)",
		handler: async (args, ctx) => {
			await loadLedger();
			const action = args.trim();
			if (action === "import") await importSessions();
			if (action === "text") {
				const report = summary(records.values());
				if (ctx.hasUI) await ctx.ui.editor("Pi spend", report);
				else console.log(report);
				return;
			}

			await mkdir(CACHE_DIR, { recursive: true });
			await writeFile(GRAPH_FILE, graphHtml(records.values()));
			const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
			const commandArgs = process.platform === "win32" ? ["/c", "start", "", GRAPH_FILE] : [GRAPH_FILE];
			const result = await pi.exec(command, commandArgs, { timeout: 5_000 });
			if (result.code !== 0) {
				ctx.ui.notify(`Could not open ${GRAPH_FILE}`, "error");
			}
		},
	});
}
