import assert from "node:assert/strict";
import test from "node:test";

import { waitForTasks } from "./index.ts";

test("shutdown wait is bounded for unfinished speech", async () => {
	const started = Date.now();
	await waitForTasks([new Promise<void>(() => {})], 10);
	assert.ok(Date.now() - started < 100);
});
