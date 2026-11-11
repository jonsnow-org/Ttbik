import { NextRequest } from "next/server";
import { POST } from "@/app/api/telegram/verify-task/route";

describe("legacy unauthenticated task payout endpoint", () => {
  it("returns Gone and never accepts caller-supplied payout identity", async () => {
    const response = await POST(new NextRequest("https://site.test/api/telegram/verify-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "victim", adId: "ad", botToken: "fake", botId: "bot" }),
    }));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ success: false });
  });
});
