
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicMediaPost, canAccessMediaPost } from "../../src/lib/mediaVisibility.ts";

test("public media excludes hidden posts and posts assigned to a private squad", () => {
  assert.equal(isPublicMediaPost({ hidden: false, squad_code: "" }), true);
  assert.equal(isPublicMediaPost({ hidden: null, squad_code: null }), true);
  assert.equal(isPublicMediaPost({ hidden: true, squad_code: "" }), false);
  assert.equal(isPublicMediaPost({ hidden: false, squad_code: "private-room" }), false);
});

test("private squad media requires an exact code and cannot override hidden state", () => {
  const post = { hidden: false, squad_code: "private-room" };
  assert.equal(canAccessMediaPost(post, "private-room"), true);
  assert.equal(canAccessMediaPost(post, "other-room"), false);
  assert.equal(canAccessMediaPost(post, ""), false);
  assert.equal(canAccessMediaPost({ ...post, hidden: true }, "private-room"), false);
});

test("public media does not require or accept a non-empty squad code", () => {
  const post = { hidden: false, squad_code: "" };
  assert.equal(canAccessMediaPost(post, undefined), true);
  assert.equal(canAccessMediaPost(post, ""), true);
  assert.equal(canAccessMediaPost(post, "private-room"), false);
});

test("media proxy and comment APIs enforce visibility rather than relying on the feed UI", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (name) => readFileSync(path.join(root, name), "utf8");
  const comments = read("src/app/api/media-comments/route.ts");
  const stream = read("src/app/api/media-stream/route.ts");
  const pathRoute = read("src/app/api/media-path/route.ts");
  const thumb = read("src/app/api/media-thumb/route.ts");
  const social = read("src/app/api/media-social/route.ts");

  assert.match(comments, /isPublicMediaPost\(parentPost\)/);
  assert.match(stream, /canAccessMediaPost\(data, req\.nextUrl\.searchParams\.get\("squad"\)\)/);
  assert.match(pathRoute, /isPublicMediaPost\(row\)/);
  assert.match(thumb, /canAccessMediaPost\(data, req\.nextUrl\.searchParams\.get\("squad"\)\)/);
  assert.match(social, /isPublicMediaPost\(post\)/);
});
