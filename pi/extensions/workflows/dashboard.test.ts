import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistoricalRunCache, type RunEntry } from "./dashboard.ts";
import type { WorkflowDetails } from "./model.ts";

const details = {
	runId: "wf_live",
	sessionId: "session",
	background: false,
	status: "running",
	startedAt: 1,
	phases: [],
	agents: [],
} satisfies WorkflowDetails;

test("dashboard caches history until the live run set changes", async () => {
	let loads = 0;
	const history: RunEntry[] = [];
	const cache = createHistoricalRunCache(async () => {
		loads += 1;
		return history;
	});
	const active = new Map([[details.runId, details]]);

	assert.equal(await cache.get(active, "session", new Set(), true), history);
	assert.equal(await cache.get(active, "session", new Set()), history);
	assert.equal(loads, 1);

	await cache.get(new Map(), "session", new Set());
	assert.equal(loads, 2);
});
