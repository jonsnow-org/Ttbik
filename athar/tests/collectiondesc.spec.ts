import { collectionResponse } from "../web/lib/handlers";
it("the collection description names the kinds and claims no fixed range of dates", async () => {
  const d = (await collectionResponse("https://x", "https://x/img").json()).description as string;
  expect(d).toContain("Normal, Silver and Gold");
  expect(d).toContain("عادي وفضي وذهبي");
  expect(d).not.toMatch(/1950|2007|available now/);
});
