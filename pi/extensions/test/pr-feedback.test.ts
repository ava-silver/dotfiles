import assert from "node:assert/strict";
import test from "node:test";
import {
	GH_TIMEOUT_MS,
	ghTimeout,
	graphqlArgs,
	mapWithConcurrency,
	paginateConnection,
	resolvedCommentIds,
} from "../pr-feedback.ts";

test("paginateConnection collects every cursor page", async () => {
	const cursors: Array<string | null> = [];
	const nodes = await paginateConnection(async (after) => {
		cursors.push(after);
		if (after === null) return { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "first" } };
		if (after === "first") return { nodes: [3], pageInfo: { hasNextPage: true, endCursor: "second" } };
		return { nodes: [4], pageInfo: { hasNextPage: false, endCursor: null } };
	});

	assert.deepEqual(nodes, [1, 2, 3, 4]);
	assert.deepEqual(cursors, [null, "first", "second"]);
});

test("mapWithConcurrency caps concurrency and preserves order", async () => {
	let active = 0;
	let maxActive = 0;
	const items = [0, 1, 2, 3, 4, 5, 6, 7];
	const results = await mapWithConcurrency(items, 4, async (item) => {
		active++;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, (items.length - item) * 2));
		active--;
		return item;
	});

	assert.equal(maxActive, 4);
	assert.deepEqual(results, items);
});

test("gh limits normal calls and reserves a longer limit for pagination", () => {
	assert.equal(ghTimeout(["pr", "view"]), GH_TIMEOUT_MS);
	assert.equal(ghTimeout(["api", "repos/acme/widgets/pulls/1/comments", "--paginate"]), 60_000);
});

test("GraphQL integer variables use typed gh fields", () => {
	assert.deepEqual(graphqlArgs("query", { owner: "acme", pr: 123 }), [
		"api",
		"graphql",
		"-f",
		"query=query",
		"-f",
		"owner=acme",
		"-F",
		"pr=123",
	]);
});

test("resolvedCommentIds excludes unresolved threads", () => {
	assert.deepEqual(
		resolvedCommentIds([
			{ isResolved: false, comments: [1, 2] },
			{ isResolved: true, comments: [3, 4] },
		]),
		new Set([3, 4]),
	);
});
