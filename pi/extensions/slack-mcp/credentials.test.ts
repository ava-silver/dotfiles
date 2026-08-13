import assert from "node:assert/strict";
import test from "node:test";

import { KEYCHAIN_TIMEOUT_MS, securityOptions } from "./credentials.ts";

test("keychain calls use a deadline and caller cancellation", () => {
	const controller = new AbortController();
	assert.deepEqual(securityOptions(controller.signal), {
		encoding: "utf8",
		timeout: KEYCHAIN_TIMEOUT_MS,
		signal: controller.signal,
	});
	assert.deepEqual(securityOptions(), { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS });
});
