import { dbUrl } from "../dbUrl";

const sess = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
describe("dbUrl", () => {
  test("Supabase session-mode pooler moves to the transaction pooler with pgbouncer=true", () => {
    const u = new URL(dbUrl(sess, {})!);
    expect(u.port).toBe("6543");
    expect(u.searchParams.get("pgbouncer")).toBe("true");
    expect(u.searchParams.get("connection_limit")).toBe("1");
    expect(u.username).toBe("postgres.abcd");
  });
  test("a URL already on 6543 keeps its own settings", () => {
    const u = new URL(dbUrl("postgresql://postgres.abcd:s@x.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=3", {})!);
    expect(u.port).toBe("6543");
    expect(u.searchParams.get("connection_limit")).toBe("3");
  });
  test("PRISMA_SESSION_MODE=1 keeps session mode", () => {
    expect(new URL(dbUrl(sess, { PRISMA_SESSION_MODE: "1" })!).port).toBe("5432");
  });
  test("a direct (non-pooler) host is not touched except for the pool limits", () => {
    const u = new URL(dbUrl("postgresql://postgres:p@db.abcd.supabase.co:5432/postgres", {})!);
    expect(u.port).toBe("5432");
    expect(u.searchParams.has("pgbouncer")).toBe(false);
  });
  test("empty and invalid values pass through", () => {
    expect(dbUrl(undefined, {})).toBeUndefined();
    expect(dbUrl("not a url", {})).toBe("not a url");
  });
});
