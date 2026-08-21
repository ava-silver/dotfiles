import assert from "node:assert/strict";
import test from "node:test";

import { asRecord, graphHtml, parseLedger, parseLedgerRecord, recordKey, type SpendRecord } from "../spend.ts";

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
