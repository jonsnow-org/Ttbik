import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyFollowIds } from "../../src/lib/mediaFollowMigration.ts";

test("retains only failed follow IDs for a future retry", async () => {
  const attempts = [];
  const result = await migrateLegacyFollowIds(
    ["user-a", "user-b", "user-c"],
    async (id) => {
      attempts.push(id);
      if (id === "user-b") throw new Error("temporary network failure");
    },
  );

  assert.deepEqual(attempts.sort(), ["user-a", "user-b", "user-c"]);
  assert.deepEqual(result.migratedIds.sort(), ["user-a", "user-c"]);
  assert.deepEqual(result.pendingIds, ["user-b"]);
});

test("deduplicates legacy IDs and treats an empty list as complete", async () => {
  const attempts = [];
  const result = await migrateLegacyFollowIds(
    ["user-a", "user-a", "user-b"],
    async (id) => attempts.push(id),
  );

  assert.deepEqual(attempts.sort(), ["user-a", "user-b"]);
  assert.deepEqual(result.pendingIds, []);
  assert.deepEqual(
    await migrateLegacyFollowIds([], async () => {
      throw new Error("must not run");
    }),
    { migratedIds: [], pendingIds: [] },
  );
});
