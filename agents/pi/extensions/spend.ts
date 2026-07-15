import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const STATUS_KEY = "spend";
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi");
const LEDGER_FILE = join(CACHE_DIR, "spend-v1.jsonl");
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

type SpendRecord = {
	v: 1;
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

function asRecord(entry: any, session: SessionFile): SpendRecord | undefined {
	const message = entry?.message as AssistantMessage | undefined;
	if (entry?.type !== "message" || message?.role !== "assistant" || !message.usage) return;

	const cost = message.usage.cost?.total;
	if (!Number.isFinite(cost)) return;

	return {
		v: 1,
		key: entry.id,
		sessionId: session.id,
		cwd: session.cwd,
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
	const children = await Promise.all(entries.map((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? sessionFiles(path) : entry.isFile() && path.endsWith(".jsonl") ? [path] : [];
	}));
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
			if (entry.type === "session") {
				session = { path, id: entry.id, cwd: entry.cwd };
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
	const top = (items: Map<string, number>) => [...items]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([name, cost]) => `  ${formatCost(cost)}  ${name}`);
	return [
		`Pi spend: ${formatCost(total)} across ${bySession.size} sessions (${all.length} responses)`,
		"By model:", ...top(byModel),
		"By session:", ...top(bySession),
	].join("\n");
}

export default function spendExtension(pi: ExtensionAPI): void {
	const records = new Map<string, SpendRecord>();
	let initialized = false;

	async function loadLedger(): Promise<void> {
		if (initialized) return;
		initialized = true;
		try {
			for (const line of (await readFile(LEDGER_FILE, "utf8")).split("\n")) {
				if (!line) continue;
				try {
					const record = JSON.parse(line) as SpendRecord;
					if (record.v === 1 && typeof record.key === "string") records.set(record.key, record);
				} catch { /* ignore malformed cache entries */ }
			}
		} catch { /* the ledger is created on first write */ }
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

	function render(ctx: ExtensionContext): void {
		const total = [...records.values()].reduce((sum, record) => sum + record.cost, 0);
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `󰄬 ${formatCost(total)}`));
	}

	pi.on("session_start", async (_event, ctx) => {
		await loadLedger();
		const file = ctx.sessionManager.getSessionFile();
		if (file) {
			const parsed = await parseSession(file);
			if (parsed) await save(parsed.records);
		}
		render(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		await loadLedger();
		const entries = ctx.sessionManager.getEntries();
		const entry = [...entries].reverse().find((candidate: any) =>
			candidate.type === "message" && candidate.message.role === "assistant" &&
			candidate.message.timestamp === event.message.timestamp,
		);
		const header = ctx.sessionManager.getHeader();
		if (entry && header) {
			const record = asRecord(entry, { path: ctx.sessionManager.getSessionFile() || "", id: header.id, cwd: header.cwd });
			if (record) await save([record]);
		}
		render(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

	pi.registerCommand("spend", {
		description: "Show total Pi spend, broken down by model and session",
		handler: async (args, ctx) => {
			await loadLedger();
			if (args.trim() === "import") await importSessions();
			render(ctx);
			const report = summary(records.values());
			if (ctx.hasUI) await ctx.ui.editor("Pi spend", report);
			else console.log(report);
		},
	});
}
