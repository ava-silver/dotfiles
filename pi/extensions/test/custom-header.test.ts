import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { fitHeader } from "../custom-header.ts";

test("header lines do not exceed the render width", () => {
	const [line] = fitHeader(["\x1b[31mwide header\x1b[39m"], 4);
	assert.ok(line);
	assert.equal(visibleWidth(line), 4);
});
