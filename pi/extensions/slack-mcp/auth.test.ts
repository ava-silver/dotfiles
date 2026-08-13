import assert from "node:assert/strict";
import test from "node:test";

import { OPEN_TIMEOUT_MS, openOptions, withDeadline } from "./auth.ts";

test("open uses a deadline and caller cancellation", () => {
	const controller = new AbortController();
	assert.deepEqual(openOptions(controller.signal), { timeout: OPEN_TIMEOUT_MS, signal: controller.signal });
	assert.deepEqual(openOptions(), { timeout: OPEN_TIMEOUT_MS });
});

test("OAuth deadline preserves caller cancellation", () => {
	const controller = new AbortController();
	const signal = withDeadline(controller.signal, 60_000);
	controller.abort();
	assert.equal(signal.aborted, true);
});
