/** @jest-environment node */
// The promo upload used to answer a bare "youtube-not-authorised" whatever Google said; now the reason is part of the answer.
jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn(async () => 0), $queryRawUnsafe: jest.fn(async () => []) } }));
import { accessTokenOrReason, youtubeCheck } from "@/lib/youtubePublish";

const realFetch = global.fetch;
const env = { ...process.env };
beforeEach(() => { process.env.YOUTUBE_CLIENT_ID = "cid"; process.env.YOUTUBE_CLIENT_SECRET = "csec"; process.env.YOUTUBE_REFRESH_TOKEN = "rt"; });
afterEach(() => { global.fetch = realFetch; process.env = { ...env }; });
const google = (status: number, body: unknown) => { global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch; };

describe("YouTube token reason", () => {
  test("a good refresh gives a token", async () => {
    google(200, { access_token: "at" });
    expect(await accessTokenOrReason()).toEqual({ token: "at" });
    expect(await youtubeCheck()).toEqual({ clientKeys: true, refreshToken: true, google: "ok" });
  });
  test("a revoked or expired refresh token is named (invalid_grant)", async () => {
    google(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    const r = await accessTokenOrReason();
    expect(r).toEqual({ why: "invalid_grant: Token has been expired or revoked." });
  });
  test("wrong client keys are named", async () => {
    google(401, { error: "invalid_client" });
    expect(await accessTokenOrReason()).toEqual({ why: "invalid_client" });
  });
  test("missing pieces are named", async () => {
    delete process.env.YOUTUBE_CLIENT_SECRET;
    expect(await accessTokenOrReason()).toEqual({ why: "no-client-keys" });
    delete process.env.YOUTUBE_REFRESH_TOKEN;
    expect(await accessTokenOrReason()).toEqual({ why: "no-refresh-token" });
  });
  test("a network failure is named", async () => {
    global.fetch = jest.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await accessTokenOrReason()).toEqual({ why: "network" });
  });
});
