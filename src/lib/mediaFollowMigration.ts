export type FollowMigrationResult = {
  migratedIds: string[];
  pendingIds: string[];
};

/**
 * Migrate legacy device follows without losing entries after a partial
 * network/database failure. The caller only marks migration complete when
 * pendingIds is empty; already-migrated IDs are filtered from the next read.
 */
export async function migrateLegacyFollowIds(
  ids: string[],
  follow: (id: string) => Promise<unknown>,
): Promise<FollowMigrationResult> {
  const results = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        await follow(id);
        return { id, migrated: true };
      } catch {
        return { id, migrated: false };
      }
    }),
  );

  return {
    migratedIds: results.filter((item) => item.migrated).map((item) => item.id),
    pendingIds: results.filter((item) => !item.migrated).map((item) => item.id),
  };
}
