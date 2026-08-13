import assert from "node:assert/strict";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import mergeGuard, { classifyGhPrMerge, containsGhApiMerge } from "../pr-merge-guard.ts";

test("allows only targetless gh pr merge commands with recognized options", () => {
	for (const command of [
		"gh pr merge",
		"gh pr merge --squash --delete-branch",
		"gh pr merge -A ava@example.com -b done -F body.md -m -r -s -d",
		"gh pr merge --admin --auto --disable-auto --author-email ava@example.com --body-file body.md --merge --rebase --squash",
		'gh pr merge --subject "release notes" --body=done --match-head-commit abc123',
		"gh --hostname github.example.com --config git_protocol=ssh pr merge --squash",
		"echo start; gh pr merge --merge",
		"gh pr merge --merge | tee merge.log",
	]) {
		assert.equal(classifyGhPrMerge(command), "current-branch", command);
	}
});

test("scans newlines and lone ampersands as command boundaries", () => {
	for (const command of ["echo start\ngh pr merge 123", "echo start & gh pr merge 123"]) {
		assert.equal(classifyGhPrMerge(command), "blocked", command);
	}
	for (const command of [
		"echo start\ngh api repos/org/repo/pulls/123/merge -X PUT",
		"echo start & gh api repos/org/repo/pulls/123/merge -X PUT",
	]) {
		assert.equal(containsGhApiMerge(command), true, command);
	}
});

test("blocks explicit or ambiguous gh pr merge targets", () => {
	for (const command of [
		"gh pr merge 123",
		"gh -R other/repo pr merge 123",
		"gh pr merge --squash 123",
		"gh pr merge https://github.com/org/repo/pull/123",
		"gh pr merge ava.silver/feature",
		"gh pr merge --repo org/repo",
		"gh pr merge --unknown",
		"gh pr merge 123 && echo merged",
		'gh pr merge "123"',
		"gh pr merge --body $(cat body.md)",
		"gh pr merge --squash > merge.log",
	]) {
		assert.equal(classifyGhPrMerge(command), "blocked", command);
	}
});

test("blocks merges submitted through terminal_run", async () => {
	let handler: ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | void>) | undefined;
	mergeGuard({
		on(event: string, callback: unknown) {
			if (event === "tool_call") handler = callback as typeof handler;
		},
	} as ExtensionAPI);

	const result = await handler?.(
		{
			type: "tool_call",
			toolCallId: "test",
			toolName: "terminal_run",
			input: { command: "gh pr merge 123" },
		} as ToolCallEvent,
		{ cwd: process.cwd() } as ExtensionContext,
	);
	assert.equal(result?.block, true);
});

test("detects gh by executable basename", () => {
	for (const command of [
		"/usr/local/bin/gh pr merge",
		"g\\h pr merge",
		"/usr/local/bin/g\\h pr merge",
		'"/usr/local/bin/gh" pr merge',
	]) {
		assert.equal(classifyGhPrMerge(command), "current-branch", command);
	}
});

test("ignores non-merge commands", () => {
	assert.equal(classifyGhPrMerge("gh pr view 123"), "none");
});

test("ignores harmless compound commands", () => {
	for (const command of [
		"echo start; echo done",
		"true && echo done || echo failed",
		"printf '%s\\n' done | cat",
		'echo "a; b && c | d"',
	]) {
		assert.equal(classifyGhPrMerge(command), "none", command);
		assert.equal(containsGhApiMerge(command), false, command);
	}
});

test("unwraps rtk, gh assignments, and wrappers", () => {
	for (const command of [
		"GH_PROMPT_DISABLED=1 gh pr merge",
		"env gh pr merge",
		"command gh pr merge",
		"rtk gh pr merge",
		"rtk env GH_PROMPT_DISABLED=1 gh pr merge",
	]) {
		assert.equal(classifyGhPrMerge(command), "current-branch", command);
	}
	assert.equal(classifyGhPrMerge("rtk gh pr merge 123"), "blocked");
	for (const command of [
		"GH_PROMPT_DISABLED=1 gh api repos/org/repo/pulls/123/merge -X PUT",
		"env gh api repos/org/repo/pulls/123/merge -X PUT",
		"command gh api repos/org/repo/pulls/123/merge -X PUT",
		"rtk gh api repos/org/repo/pulls/123/merge -X PUT",
	]) {
		assert.equal(containsGhApiMerge(command), true, command);
	}
});

test("fails closed for unrecognized wrappers only with gh merge evidence", () => {
	assert.equal(classifyGhPrMerge("wrapper gh pr merge 123"), "blocked");
	assert.equal(containsGhApiMerge("wrapper gh api repos/org/repo/pulls/123/merge -X PUT"), true);
	for (const command of [
		"wrapper echo harmless",
		"wrapper gh pr view 123",
		"wrapper gh api repos/org/repo/pulls/123",
	]) {
		assert.equal(classifyGhPrMerge(command), "none", command);
		assert.equal(containsGhApiMerge(command), false, command);
	}
});

test("detects gh api merge endpoints and GraphQL mutations", () => {
	assert.equal(containsGhApiMerge("gh api repos/org/repo/pulls/123/merge -X PUT"), true);
	assert.equal(containsGhApiMerge("/usr/local/bin/gh api repos/org/repo/pulls/123/merge -X PUT"), true);
	assert.equal(containsGhApiMerge("g\\h api repos/org/repo/pulls/123/merge -X PUT"), true);
	assert.equal(containsGhApiMerge("/usr/local/bin/g\\h api repos/org/repo/pulls/123/merge -X PUT"), true);
	assert.equal(
		containsGhApiMerge('gh api graphql -f query="mutation { mergePullRequest(input: {}) { clientMutationId } }"'),
		true,
	);
	assert.equal(containsGhApiMerge("gh api repos/org/repo/pulls/123"), false);
});
