import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	asRecord,
	createSpendStore,
	graphHtml,
	mapBounded,
	parseLedger,
	parseLedgerRecord,
	parseStableSession,
	recordKey,
	type SpendRecord,
} from "../spend.ts";

const timestamp = Date.UTC(2025, 0, 1);
const usage = {
	input: 1,
	output: 2,
	cacheRead: 3,
	cacheWrite: 4,
	totalTokens: 10,
	cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
};

function record(overrides: Partial<SpendRecord> = {}): SpendRecord {
	return {
		v: 3,
		key: recordKey("assistant", "entry", timestamp),
		kind: "assistant",
		entryId: "entry",
		sessionId: "session-a",
		timestamp,
		provider: "test",
		model: "model",
		cost: 0.1,
		input: 1,
		output: 2,
		cacheRead: 3,
		cacheWrite: 4,
		...overrides,
	};
}

test("spend records use entry identity across forked sessions", () => {
	const entry = {
		type: "message",
		id: "entry",
		message: { role: "assistant", timestamp, provider: "test", model: "model", usage },
	};
	assert.equal(asRecord(entry, { id: "session-a" })?.key, asRecord(entry, { id: "session-b" })?.key);
});

test("spend ledger accepts v3 and migrates valid v1 and v2 records", () => {
	const fields = {
		sessionId: "session-a",
		timestamp,
		provider: "test",
		model: "model",
		cost: 0.1,
		input: 1,
		output: 2,
		cacheRead: 3,
		cacheWrite: 4,
	};
	const expected = record();
	assert.deepEqual(parseLedgerRecord({ v: 1, key: "entry", unexpected: "ignored", ...fields }), expected);
	assert.deepEqual(parseLedgerRecord({ v: 2, key: "session-a:entry", ...fields }), expected);
	assert.deepEqual(parseLedgerRecord(expected), expected);
	assert.equal(parseLedgerRecord({ ...expected, key: "wrong" }), undefined);
});

test("spend records nested tool and summary usage", () => {
	assert.deepEqual(
		asRecord(
			{ type: "message", id: "tool-entry", message: { role: "toolResult", timestamp, usage } },
			{ id: "session-a" },
		),
		record({
			key: recordKey("tool", "tool-entry", timestamp),
			kind: "tool",
			entryId: "tool-entry",
			provider: "Tools",
			model: "summaries",
		}),
	);
	for (const kind of ["compaction", "branch_summary"] as const) {
		const entryId = `${kind}-entry`;
		assert.deepEqual(
			asRecord({ type: kind, id: entryId, timestamp: new Date(timestamp).toISOString(), usage }, { id: "session-a" }),
			record({
				key: recordKey(kind, entryId, timestamp),
				kind,
				entryId,
				provider: "Tools",
				model: "summaries",
			}),
		);
	}
});

test("spend ledger rejects malformed cwd values", () => {
	assert.equal(parseLedgerRecord({ ...record(), cwd: 42 }), undefined);
});

test("spend ledger rejects timestamps outside sensible Date bounds", () => {
	const invalid = record({ timestamp: Number.MAX_VALUE });
	assert.equal(parseLedgerRecord(invalid), undefined);
	assert.doesNotThrow(() => graphHtml([invalid]));
});

test("spend ledger continues after a malformed JSONL line", () => {
	const valid = record();
	assert.deepEqual(parseLedger(`{not JSON}\n${JSON.stringify(valid)}`), [valid]);
});

test("spend graph omits models below $1", () => {
	const html = graphHtml([
		record({ model: "low-cost", cost: 0.99 }),
		record({
			key: recordKey("assistant", "high-entry", timestamp),
			entryId: "high-entry",
			model: "high-cost",
			cost: 1,
		}),
	]);
	assert.equal(html.includes("low-cost"), false);
	assert.equal(html.includes("high-cost"), true);
});

test("spend graph renders hostile model names as text", () => {
	const model = "</span><img src=x onerror=alert(1)>";
	const html = graphHtml([record({ model, cost: 1 })]);
	assert.doesNotMatch(html, /innerHTML/);
	assert.equal(html.includes(model), false);
	assert.match(html, /textContent/);
});

const session = (id: string, entry = "entry") =>
	`${JSON.stringify({ type: "session", id, cwd: "/work" })}\n${JSON.stringify({ type: "message", id: entry, message: { role: "assistant", timestamp, provider: "test", model: "model", usage } })}\n`;

async function spendFixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-spend-"));
	const cacheDir = join(root, "cache");
	const sessionsDir = join(root, "sessions");
	await mkdir(sessionsDir, { recursive: true });
	return { root, cacheDir, sessionsDir, legacyLedgerFiles: [] };
}

test("spend index seeds existing ledger metadata without reparsing sessions", async (t) => {
	const fixture = await spendFixture();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));
	await mkdir(fixture.cacheDir, { recursive: true });
	await writeFile(join(fixture.cacheDir, "spend-v3.jsonl"), `${JSON.stringify(record())}\n`);
	await writeFile(join(fixture.sessionsDir, "existing.jsonl"), "not json\n");
	const store = createSpendStore(fixture);
	await store.importSessions();
	assert.equal(store.records.size, 1);
	const index = JSON.parse(await readFile(join(fixture.cacheDir, "spend-v3-index.json"), "utf8"));
	assert.ok(index.sessions[join(fixture.sessionsDir, "existing.jsonl")]);
});

test("spend rebuilds a malformed index instead of skipping sessions", async (t) => {
	const fixture = await spendFixture();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));
	await mkdir(fixture.cacheDir, { recursive: true });
	await writeFile(join(fixture.cacheDir, "spend-v3.jsonl"), `${JSON.stringify(record())}\n`);
	await writeFile(join(fixture.cacheDir, "spend-v3-index.json"), "{bad}");
	await writeFile(join(fixture.sessionsDir, "new.jsonl"), session("new", "new-entry"));

	const store = createSpendStore(fixture);
	await store.importSessions();

	assert.equal(store.records.size, 2);
});

test("spend serializes concurrent ledger appends", async (t) => {
	const fixture = await spendFixture();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));
	const store = createSpendStore(fixture);
	await store.loadLedger();

	await Promise.all([store.save([record()]), store.save([record()])]);

	const lines = (await readFile(join(fixture.cacheDir, "spend-v3.jsonl"), "utf8")).trim().split("\n");
	assert.equal(lines.length, 1);
});

test("spend index imports changed and new files, skips unchanged files, and prunes deleted files", async (t) => {
	const fixture = await spendFixture();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));
	const first = join(fixture.sessionsDir, "first.jsonl");
	await writeFile(first, session("one"));
	const store = createSpendStore(fixture);
	await store.importSessions();
	assert.equal(store.records.size, 1);
	await store.importSessions();
	assert.equal(store.records.size, 1);
	await writeFile(first, `${session("one")} ${"\n"}${session("one", "changed")}`);
	const second = join(fixture.sessionsDir, "second.jsonl");
	await writeFile(second, session("two", "second"));
	await store.importSessions();
	assert.equal(store.records.size, 3);
	await rm(first);
	await store.importSessions();
	const index = JSON.parse(await readFile(join(fixture.cacheDir, "spend-v3-index.json"), "utf8"));
	assert.equal(index.sessions[first], undefined);
	assert.ok(index.sessions[second]);
});

test("spend retries read races and partial final records", async () => {
	let calls = 0;
	const metadata = [
		{ size: 1, mtimeMs: 1 },
		{ size: 2, mtimeMs: 2 },
		{ size: 2, mtimeMs: 2 },
		{ size: 2, mtimeMs: 2 },
	];
	const raced = await parseStableSession("race", {
		getMetadata: async () => metadata.shift() || { size: 2, mtimeMs: 2 },
		read: async () => session("race"),
	});
	assert.equal(raced?.records.length, 1);
	const partial = await parseStableSession("partial", {
		getMetadata: async () => ({ size: 1, mtimeMs: 1 }),
		read: async () => (++calls === 1 ? "{" : session("partial")),
	});
	assert.equal(partial?.records.length, 1);
	assert.equal(calls, 2);
});

test("spend accepts malformed interior lines when the final record is complete", async (t) => {
	const fixture = await spendFixture();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));
	const file = join(fixture.sessionsDir, "interior.jsonl");
	await writeFile(
		file,
		`${JSON.stringify({ type: "session", id: "interior" })}\n{bad}\n${session("ignored", "valid").split("\n").at(1)}\n`,
	);
	const parsed = await parseStableSession(file);
	assert.equal(parsed?.records.length, 1);
});

test("spend bounds concurrent imports", async () => {
	let active = 0;
	let maximum = 0;
	const result = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
		active++;
		maximum = Math.max(maximum, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active--;
		return value * 2;
	});
	assert.deepEqual(result, [2, 4, 6, 8, 10]);
	assert.equal(maximum, 2);
});
