import assert from "node:assert/strict";
import test from "node:test";
import {
  createPickerLauncher,
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/takeover.ts";

test("picker launcher suppresses concurrent opens and resets after close", async () => {
  let opens = 0;
  let close!: () => void;
  const firstOpen = new Promise<void>((resolve) => {
    close = resolve;
  });
  const launch = createPickerLauncher(
    async () => {
      opens += 1;
      if (opens === 1) await firstOpen;
    },
    (error) => assert.fail(String(error)),
  );

  const first = launch();
  const duplicate = launch();
  assert.strictEqual(duplicate, first);
  await Promise.resolve();
  assert.equal(opens, 1);

  close();
  await first;
  await launch();
  assert.equal(opens, 2);
});

test("picker launcher reports errors and allows retry", async () => {
  const errors: unknown[] = [];
  let opens = 0;
  const launch = createPickerLauncher(
    async () => {
      opens += 1;
      if (opens === 1) throw new Error("failed");
    },
    (error) => errors.push(error),
  );

  await launch();
  await launch();

  assert.equal(opens, 2);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /failed/);
});

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});
