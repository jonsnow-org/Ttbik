import {
  addMcpServer,
  connectorById,
  connectorReady,
  connectedIds,
  listConnectors,
  linkWithToken,
  tokenStorageReady,
} from "@/lib/coderConnectors";
import type { Db } from "@/lib/coderAuth";

const emptyDb: Db = {
  exec: async () => undefined,
  query: async <T,>() => [] as T[],
};

describe("connector encrypted-storage readiness", () => {
  const previous = {
    key: process.env.CODER_TOKEN_KEY,
    githubId: process.env.CODER_GITHUB_CLIENT_ID,
    githubSecret: process.env.CODER_GITHUB_CLIENT_SECRET,
  };

  beforeEach(() => {
    process.env.CODER_GITHUB_CLIENT_ID = "test-client-id";
    process.env.CODER_GITHUB_CLIENT_SECRET = "test-client-secret";
    delete process.env.CODER_TOKEN_KEY;
  });

  afterEach(() => {
    if (previous.key === undefined) delete process.env.CODER_TOKEN_KEY;
    else process.env.CODER_TOKEN_KEY = previous.key;
    if (previous.githubId === undefined) delete process.env.CODER_GITHUB_CLIENT_ID;
    else process.env.CODER_GITHUB_CLIENT_ID = previous.githubId;
    if (previous.githubSecret === undefined) delete process.env.CODER_GITHUB_CLIENT_SECRET;
    else process.env.CODER_GITHUB_CLIENT_SECRET = previous.githubSecret;
  });

  it("does not advertise OAuth or personal-token linking without the encryption key", async () => {
    const github = connectorById("github");
    expect(github).not.toBeNull();
    expect(tokenStorageReady()).toBe(false);
    expect(connectorReady(github!)).toBe(false);

    const view = await listConnectors(101, {}, emptyDb);
    const item = view.find((x) => x.id === "github");
    expect(item).toMatchObject({ status: "setup", oauth: false });
    expect(item?.token).toBeUndefined();
  });

  it("enables linking only after a dedicated encryption key is configured", async () => {
    process.env.CODER_TOKEN_KEY = "test-only-key-with-sufficient-entropy";
    const github = connectorById("github");
    expect(tokenStorageReady()).toBe(true);
    expect(connectorReady(github!)).toBe(true);

    const view = await listConnectors(101, {}, emptyDb);
    const item = view.find((x) => x.id === "github");
    expect(item).toMatchObject({ status: "available", oauth: true });
    expect(item?.token).toBeDefined();
  });

  it("rejects token and MCP links before making any network request when storage is unavailable", async () => {
    const fetch = jest.fn();
    await expect(linkWithToken(101, "github", "ghp_test_token_123456", emptyDb, fetch as any))
      .rejects.toThrow("CODER_TOKEN_KEY");
    await expect(addMcpServer(101, "https://mcp.example.test/mcp", "", "test", emptyDb))
      .rejects.toThrow("CODER_TOKEN_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not tell Nova that undecryptable legacy rows are connected", async () => {
    const db: Db = {
      exec: async () => undefined,
      query: async <T,>() => [
        { provider: "c:notion", token_enc: "v1.not-a-valid-token", login: "workspace" },
        { provider: "mcp:0123456789", token_enc: "v1.not-a-valid-token", login: "server" },
      ] as T[],
    };
    expect(await connectedIds(101, db)).toEqual([]);
  });
});
