import assert from "node:assert/strict";
import test from "node:test";

import { graphHtml, parseLedger, parseLedgerRecord, recordKey } from "../spend.ts";

const timestamp = Date.UTC(2025, 0, 1);

test("spend records use both session and entry identities", () => {
	assert.notEqual(recordKey("session-a", "entry"), recordKey("session-b", "entry"));
});

test("spend ledger accepts v2 and migrates valid v1 records", () => {
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
	assert.deepEqual(parseLedgerRecord({ v: 1, key: "entry", unexpected: "ignored", ...fields }), {
		v: 2,
		key: "session-a:entry",
		...fields,
	});
	assert.equal(parseLedgerRecord({ v: 2, key: "wrong", ...fields }), undefined);
});

test("spend ledger rejects malformed cwd values", () => {
	const fields = {
		sessionId: "session-a",
		key: "session-a:entry",
		timestamp,
		provider: "test",
		model: "model",
		cost: 0.1,
		input: 1,
		output: 2,
		cacheRead: 3,
		cacheWrite: 4,
	};
	assert.equal(parseLedgerRecord({ v: 2, ...fields, cwd: 42 }), undefined);
});

test("spend ledger rejects timestamps outside sensible Date bounds", () => {
	const fields = {
		sessionId: "session-a",
		key: "session-a:entry",
		provider: "test",
		model: "model",
		cost: 0.1,
		input: 1,
		output: 2,
		cacheRead: 3,
		cacheWrite: 4,
	};
	assert.equal(parseLedgerRecord({ v: 2, timestamp: Number.MAX_VALUE, ...fields }), undefined);
	assert.doesNotThrow(() => graphHtml([{ v: 2, timestamp: Number.MAX_VALUE, ...fields }]));
});

test("spend ledger continues after a malformed JSONL line", () => {
	const record = {
		v: 2,
		key: "session-a:entry",
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
	assert.deepEqual(parseLedger(`{not JSON}\n${JSON.stringify(record)}`), [record]);
});

test("spend graph renders hostile model names as text", () => {
	const model = "</span><img src=x onerror=alert(1)>";
	const html = graphHtml([
		{
			v: 2,
			key: "session-a:entry",
			sessionId: "session-a",
			timestamp,
			provider: "test",
			model,
			cost: 0.1,
			input: 1,
			output: 2,
			cacheRead: 3,
			cacheWrite: 4,
		},
	]);
	assert.doesNotMatch(html, /innerHTML/);
	assert.equal(html.includes(model), false);
	assert.match(html, /textContent/);
});
