import { collectionResponse } from "../web/lib/handlers";
it("collection description states the real range", async () => {
  const d = (await collectionResponse("https://x", "https://x/img").json()).description as string;
  expect(d).toContain("2000–2007");
  expect(d).not.toContain("1950");
});
