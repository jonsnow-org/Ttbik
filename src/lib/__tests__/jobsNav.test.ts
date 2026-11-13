import { MAIN_TABS, sectionScreen } from "@/lib/botApp/jobsNav";

describe("jobs & store Mini App navigation follows the bot's menu", () => {
  test("the bottom bar: home, work, store, tenders, profile", () => {
    expect(MAIN_TABS.map((t) => t.name)).toEqual(["home", "work", "store", "tenders", "account"]);
  });
  test("the bot's buttons (?s=) land on the right section", () => {
    for (const s of ["store", "work", "tenders", "account"]) expect(sectionScreen(s)).toEqual({ name: s });
    expect(sectionScreen("shops")).toEqual({ name: "shops" });
    for (const s of ["home", "", "nonsense"]) expect(sectionScreen(s)).toEqual({ name: "home" });
  });
  test("orders and my shop are inside the store section, as in the bot", () => {
    expect(sectionScreen("orders")).toEqual({ name: "store", params: { tab: "orders" } });
    expect(sectionScreen("myshop")).toEqual({ name: "store", params: { tab: "myshop" } });
  });
});
