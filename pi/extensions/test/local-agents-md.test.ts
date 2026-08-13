import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findLocalAgentsFiles } from "../local-agents-md.ts";

test("does not discover project-local instructions in an untrusted project", () => {
	const root = mkdtempSync(join(tmpdir(), "local-agents-"));
	try {
		const nested = join(root, "project", "nested");
		mkdirSync(nested, { recursive: true });
		const parentFile = join(root, "project", "AGENTS.local.md");
		const childFile = join(nested, "AGENTS.local.md");
		writeFileSync(parentFile, "parent");
		writeFileSync(childFile, "child");

		assert.deepEqual(findLocalAgentsFiles(nested, true), [parentFile, childFile]);
		assert.deepEqual(findLocalAgentsFiles(nested, false), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
