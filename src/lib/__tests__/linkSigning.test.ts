// Link signatures use the server's CRON_SECRET only: no built-in fallback key, and a link of one kind never verifies as another.
import { signLink, verifyLink } from "../linkSigning";

describe("linkSigning", () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

  it("fails closed without CRON_SECRET (the old public fallback keys are gone)", () => {
    delete process.env.CRON_SECRET;
    expect(signLink("social", "1.youtube.9")).toBe("");
    expect(verifyLink("social", "1.youtube.9", "anything")).toBe(false);
  });
  it("verifies its own links and rejects tampering or another purpose", () => {
    process.env.CRON_SECRET = "test-secret-value";
    const mac = signLink("social", "123.youtube.999");
    expect(verifyLink("social", "123.youtube.999", mac)).toBe(true);
    expect(verifyLink("social", "124.youtube.999", mac)).toBe(false);
    expect(verifyLink("youtube", "123.youtube.999", mac)).toBe(false);
    expect(verifyLink("social", "123.youtube.999", "")).toBe(false);
  });
});
