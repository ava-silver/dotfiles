import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundProvider } from "./src/hub.ts";
import { BackgroundHub } from "./src/hub.ts";

function provider(status: "running" | "done" | "error"): BackgroundProvider {
	return {
		label: "Test",
		list: () => [
			{
				id: "task-1",
				title: "task",
				status,
				elapsed: () => "1s",
				meta: () => [],
			},
		],
		subscribe: () => () => {},
		openDetail: async () => {},
	};
}

test("tracks running and completed providers", () => {
	const hub = new BackgroundHub();
	assert.equal(hub.hasAnyItems(), false);

	const unregister = hub.registerProvider("tasks", provider("running"));
	assert.equal(hub.hasAnyItems(), true);

	unregister();
	assert.equal(hub.hasAnyItems(), false);

	hub.registerProvider("tasks", provider("done"));
	assert.equal(hub.hasAnyItems(), true);
});

test("hubs isolate parent and child sessions", () => {
	const parent = new BackgroundHub();
	const child = new BackgroundHub();

	parent.registerProvider("tasks", provider("running"));
	assert.equal(parent.hasAnyItems(), true);
	assert.equal(child.hasAnyItems(), false);

	child.registerProvider("tasks", provider("done"));
	assert.equal(parent.hasAnyItems(), true);
	assert.equal(child.hasAnyItems(), true);
});

test("stale unregister does not remove a replacement provider", () => {
	const hub = new BackgroundHub();
	const unregisterOld = hub.registerProvider("tasks", provider("running"));
	const unregisterCurrent = hub.registerProvider("tasks", provider("done"));

	unregisterOld();
	assert.equal(hub.hasAnyItems(), true);

	unregisterCurrent();
	assert.equal(hub.hasAnyItems(), false);
});
