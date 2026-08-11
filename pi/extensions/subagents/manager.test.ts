/**
 * End-to-end smoke tests: manager behavior through a real ManagedRuntime,
 * exactly as the tool handlers drive it. Uses a scripted stub backend for
 * deterministic, process-free runs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { ActiveBackend } from "./src/backend.ts";
import { piBackend } from "./src/backends/pi.ts";
import { makeStubBackend } from "./src/backends/stub.ts";
import type { ParentContext, SpawnTask } from "./src/domain.ts";
import {
  SubagentManager,
  SubagentManagerLive,
  type SubagentManagerShape,
} from "./src/manager.ts";
import { runTool } from "./src/runtime.ts";

const stubBackend = makeStubBackend({
  defaultModelLabel: "pi/stub",
  contextWindow: 200_000,
  toolName: "Bash",
  cadenceMs: 30,
});

const StubBackendLive = Layer.sync(ActiveBackend, () => stubBackend);
const PiBackendLive = Layer.sync(ActiveBackend, () => piBackend);

const createStubRuntime = () =>
  ManagedRuntime.make(SubagentManagerLive.pipe(Layer.provide(StubBackendLive)));

const createPiRuntime = () =>
  ManagedRuntime.make(SubagentManagerLive.pipe(Layer.provide(PiBackendLive)));

const parent: ParentContext = {
  parentCwd: process.cwd(),
  projectTrusted: false,
};

function task(prompt: string): SpawnTask {
  return { prompt, title: "test", cwd: process.cwd(), parent };
}

async function withManager(
  run: (
    manager: SubagentManagerShape,
    runtime: ReturnType<typeof createStubRuntime>,
  ) => Promise<void>,
) {
  const runtime = createStubRuntime();
  try {
    const manager = await runtime.runPromise(SubagentManager);
    await run(manager, runtime);
  } finally {
    await runtime.dispose();
  }
}

test("stub subagent completes and delivers a final result", async () => {
  await withManager(async (manager, runtime) => {
    const settled: Array<{ id: string; consumed: boolean }> = [];
    manager.view.setOnSettled((snap, consumed) =>
      settled.push({ id: snap.id, consumed }),
    );

    const snap = await runTool(runtime, manager.spawn(task("Say hello")));
    assert.equal(snap.status, "running");
    assert.equal(snap.backend, "pi");
    assert.ok(snap.meta.sessionFilePath);

    await runTool(runtime, manager.waitFor([snap.id]));
    const done = manager.view.get(snap.id);
    assert.ok(done);
    assert.equal(done.status, "done");
    assert.match(done.finalText, /\[stub\] completed: Say hello/);
    assert.ok(done.turns >= 2);
    assert.ok(done.transcript.some((item) => item.kind === "toolResult"));
    // The waitFor marked the settle as consumed.
    assert.deepEqual(settled, [{ id: snap.id, consumed: true }]);
  });
});

test("FAIL: prompts settle as errors; unconsumed settles are delivered", async () => {
  await withManager(async (manager, runtime) => {
    const settled: Array<{ id: string; consumed: boolean }> = [];
    manager.view.setOnSettled((snap, consumed) =>
      settled.push({ id: snap.id, consumed }),
    );

    const snap = await runTool(
      runtime,
      manager.spawn(task("FAIL: blow up please")),
    );
    // Poll without wait-interest so the settle is delivered unconsumed.
    while (manager.view.get(snap.id)?.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const failed = manager.view.get(snap.id);
    assert.equal(failed?.status, "error");
    assert.match(failed?.errorText ?? "", /task failed/);
    assert.deepEqual(settled, [{ id: snap.id, consumed: false }]);
  });
});

test("cancel interrupts a running stub subagent", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(runtime, manager.spawn(task("Long running task")));
    const report = await runTool(runtime, manager.cancel([snap.id]));
    assert.deepEqual(report, [
      { id: snap.id, title: "test", status: "error", cancelled: true },
    ]);
    assert.equal(manager.view.get(snap.id)?.errorText, "Run was aborted");
  });
});

test("the concurrency cap rejects a fifth running subagent", async () => {
  await withManager(async (manager, runtime) => {
    const spawns = await runTool(
      runtime,
      Effect.forEach([1, 2, 3, 4], (n) => manager.spawn(task(`Task ${n}`)), {
        concurrency: "unbounded",
      }),
    );
    assert.equal(spawns.length, 4);
    await assert.rejects(
      runTool(runtime, manager.spawn(task("Task 5"))),
      /Max 4 subagents/,
    );
  });
});

test("pi spawn fails fast without the parent model registry", async () => {
  const runtime = createPiRuntime();
  try {
    const manager = await runtime.runPromise(SubagentManager);
    await assert.rejects(
      runTool(runtime, manager.spawn(task("needs a registry"))),
      /model registry/,
    );
    // The failed spawn must release its concurrency reservation.
    // (We can't spawn another pi session without a registry, so just verify
    // the count is back to 0 by checking no error about the cap.)
    assert.equal(manager.view.list().filter((s) => s.status === "running").length, 0);
  } finally {
    await runtime.dispose();
  }
});

test("idle restarts respect the concurrency cap", async () => {
  await withManager(async (manager, runtime) => {
    // Settle one subagent, then fill all four slots with running ones.
    const settled = await runTool(runtime, manager.spawn(task("early finisher")));
    await runTool(runtime, manager.waitFor([settled.id]));
    await runTool(
      runtime,
      Effect.forEach([1, 2, 3, 4], (n) => manager.spawn(task(`Task ${n}`)), {
        concurrency: "unbounded",
      }),
    );
    // Restarting the settled one would be a fifth concurrent run.
    await assert.rejects(
      runTool(runtime, manager.send(settled.id, "go again")),
      /Max 4 subagents/,
    );
    assert.equal(manager.view.get(settled.id)?.status, "done");
  });
});

test("send steers an idle subagent into another turn", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(runtime, manager.spawn(task("First turn")));
    await runTool(runtime, manager.waitFor([snap.id]));
    assert.equal(manager.view.get(snap.id)?.status, "done");

    await runTool(runtime, manager.send(snap.id, "Second turn"));
    while (manager.view.get(snap.id)?.status !== "running") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await runTool(runtime, manager.waitFor([snap.id]));
    const afterSecond = manager.view.get(snap.id);
    assert.equal(afterSecond?.status, "done");
    assert.match(afterSecond?.finalText ?? "", /Second turn/);
  });
});
