import { MAIN_TABS, sectionScreen } from "@/lib/botApp/jobsNav";

describe("jobs & store Mini App navigation", () => {
  test("five main sections, home first", () => {
    expect(MAIN_TABS.map((t) => t.name)).toEqual(["home", "store", "work", "orders", "account"]);
  });
  test("the bot's buttons (?s=) land on the right section", () => {
    for (const s of ["store", "work", "orders", "account"]) expect(sectionScreen(s)).toEqual({ name: s });
    expect(sectionScreen("home")).toEqual({ name: "home" });
    expect(sectionScreen("")).toEqual({ name: "home" });
    expect(sectionScreen("nonsense")).toEqual({ name: "home" });
  });
  test("links from before the reorganisation open their hub segment", () => {
    expect(sectionScreen("shops")).toEqual({ name: "store", params: { tab: "shops" } });
    expect(sectionScreen("myshop")).toEqual({ name: "orders", params: { tab: "myshop" } });
    expect(sectionScreen("tenders")).toEqual({ name: "work", params: { tab: "tenders" } });
  });
});
