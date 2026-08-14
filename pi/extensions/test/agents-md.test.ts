import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import localAgentsMdExtension, { findLocalAgentsFiles, findSubdirectoryAgentsFiles } from "../agents-md.ts";

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

test("discovers AGENTS.md files between the project root and a read file", () => {
	const root = mkdtempSync(join(tmpdir(), "subdirectory-agents-"));
	try {
		const sourceDir = join(root, "nested", "child");
		mkdirSync(sourceDir, { recursive: true });
		const parentFile = join(root, "nested", "AGENTS.md");
		const childFile = join(sourceDir, "AGENTS.md");
		writeFileSync(parentFile, "parent");
		writeFileSync(childFile, "child");

		assert.deepEqual(findSubdirectoryAgentsFiles(root, join(sourceDir, "source.ts")), [parentFile, childFile]);
		assert.deepEqual(findSubdirectoryAgentsFiles(root, join(root, "outside.ts")), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("adds newly discovered instructions to a read result once", () => {
	const root = mkdtempSync(join(tmpdir(), "subdirectory-agents-"));
	try {
		const sourceDir = join(root, "nested");
		mkdirSync(sourceDir);
		writeFileSync(join(sourceDir, "AGENTS.md"), "Use bun test.");

		let handler: ((event: ToolResultEvent, ctx: ExtensionContext) => unknown) | undefined;
		localAgentsMdExtension({
			on(event: string, callback: unknown) {
				if (event === "tool_result") handler = callback as typeof handler;
			},
		} as ExtensionAPI);
		const event = {
			type: "tool_result",
			toolCallId: "test",
			toolName: "read",
			input: { path: join(sourceDir, "source.ts") },
			content: [{ type: "text", text: "source" }],
			details: undefined,
			isError: false,
		} as ToolResultEvent;
		const ctx = { cwd: root, isProjectTrusted: () => true } as ExtensionContext;

		assert.ok(handler);
		const result = handler(event, ctx) as { content: Array<{ type: "text"; text: string }> };
		assert.match(result.content.at(-1)?.text ?? "", /Use bun test/);
		assert.equal(handler(event, ctx), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
