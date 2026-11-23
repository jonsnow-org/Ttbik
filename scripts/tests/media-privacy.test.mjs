
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


test("private squad feed filtering requires the signed Telegram owner admin view", () => {
  const source = readFileSync(path.join(root, "src/app/api/media-feed/route.ts"), "utf8");
  assert.match(source, /if \(includeHidden && squad\)/);
  assert.match(source, /else if \(!includeHidden\) items = items\.filter\(\(i\) => !i\.squad_code\)/);
  assert.match(source, /Telegram-signed owner identity/);
});

test("media feed compatibility reads and writes always retain privacy columns", () => {
  const route = readFileSync(path.join(root, "src/app/api/media-feed/route.ts"), "utf8");
  const bot = readFileSync(path.join(root, "media-bot/services/feed.py"), "utf8");

  // The legacy fallback may omit optional metadata, never moderation/privacy.
  assert.match(route, /select\("id,file_id,media_type,title,url,thumbnail,sharer_name,sharer_id,clones,created_at,squad_code,hidden"\)/);
  assert.match(route, /if \(r\.error\) return null/);
  assert.match(route, /databaseConfigured && fromDb === null/);
  assert.match(route, /g\.__mediaFeed = mapped/);

  // Refeeding an existing id may change the Telegram file, not its privacy state.
  assert.match(route, /select\("id,squad_code,hidden"\)/);
  assert.match(route, /const effectiveSquadCode = existingRow/);
  assert.match(route, /hidden: existingRow \? !!existingRow\.hidden : false/);
  assert.match(route, /squad_code: effectiveSquadCode/);
  assert.match(route, /persisted: false/);

  // The bot's schema-compatibility retry must not drop the squad access code.
  assert.match(bot, /"squad_code": item\["squad_code"\]/);
  assert.match(bot, /data\.get\("persisted", True\)/);
});

test("media comment replies cannot attach to comments on a different post", () => {
  const route = readFileSync(path.join(root, "src/app/api/media-comments/route.ts"), "utf8");
  assert.match(route, /\.eq\("id", parentId\)/);
  assert.match(route, /\.eq\("post_id", postId\)/);
  assert.match(route, /parent comment not found/);
  assert.match(route, /parentReplyTo/);
});
