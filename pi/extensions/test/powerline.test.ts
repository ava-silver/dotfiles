import assert from "node:assert/strict";
import test from "node:test";

import { activeBranchCost } from "../powerline.ts";

test("active branch cost restores assistant costs and their entry ids", () => {
	const restored = activeBranchCost([
		{ id: "user", type: "message", message: { role: "user" } },
		{ id: "first", type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
		{ id: "invalid", type: "message", message: { role: "assistant", usage: { cost: { total: Number.NaN } } } },
	]);
	assert.equal(restored.cost, 0.25);
	assert.deepEqual([...restored.entryIds], ["first"]);
});
