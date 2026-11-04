
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("public media feed RLS excludes hidden and private-squad posts", () => {
  const migration = readFileSync(path.join(root, "supabase/migration_public_media_visibility.sql"), "utf8");
  assert.match(migration, /create policy "public read visible media_feed"/);
  assert.match(migration, /coalesce\(hidden, false\) = false/);
  assert.match(migration, /coalesce\(squad_code, ''\) = ''/);
  assert.match(migration, /to anon, authenticated/);
});

test("public comments are visible only when their parent post is publicly visible", () => {
  const migration = readFileSync(path.join(root, "supabase/migration_public_media_visibility.sql"), "utf8");
  assert.match(migration, /create policy "public read comments on visible media"/);
  assert.match(migration, /post_id in \(select id from public\.media_feed\)/);
});

test("watch-party room and chat rows are not granted to public roles", () => {
  const migration = readFileSync(path.join(root, "supabase/migration_public_media_visibility.sql"), "utf8");
  const setup = readFileSync(path.join(root, "supabase/migration_party_rooms.sql"), "utf8");
  assert.match(migration, /revoke all on public\.party_rooms, public\.party_messages from anon, authenticated/);
  assert.match(setup, /revoke all on public\.party_rooms, public\.party_messages from anon, authenticated/);
  assert.doesNotMatch(setup, /create policy "public read party_(rooms|messages)"/);
});

test("party API uses a server-only key and checks room membership before returning messages", () => {
  const source = readFileSync(path.join(root, "src/app/api/party/route.ts"), "utf8");
  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /members\.some\(\(member: any\) => String\(member\.id\) === user\.id\)/);
});
