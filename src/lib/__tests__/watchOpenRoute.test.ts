import { NextRequest } from "next/server";

const mockPrisma = {
  adClick: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  ad: {
    findUnique: jest.fn(),
  },
};
jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { POST } from "@/app/watch/[token]/open/route";

const call = (token = "click-1") =>
  POST(new NextRequest(`https://site.test/watch/${token}/open`, { method: "POST" }), {
    params: Promise.resolve({ token }),
  });

describe("POST /watch/[token]/open", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.adClick.findUnique.mockResolvedValue({ id: "click-1", adId: "ad-1" });
    mockPrisma.ad.findUnique.mockResolvedValue({
      id: "ad-1", type: "LINK", content: "example.org", status: "ACTIVE", cpc: 0.005, remaining: 1,
    });
    mockPrisma.adClick.update.mockResolvedValue({});
  });

  it("records the user-initiated outbound click before redirecting", async () => {
    const response = await call();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.org/");
    expect(mockPrisma.adClick.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "click-1" },
      data: expect.objectContaining({ verified: true, issuedAt: expect.any(Date) }),
    }));
  });

  it("does not start the timer for Telegram channel membership tasks", async () => {
    mockPrisma.ad.findUnique.mockResolvedValue({
      id: "ad-1", type: "TELEGRAM", content: "@channel", status: "ACTIVE", cpc: 0.003, remaining: 1,
    });
    const response = await call();
    expect(response.status).toBe(400);
    expect(mockPrisma.adClick.update).not.toHaveBeenCalled();
  });

  it("refuses exhausted campaigns before recording a click", async () => {
    mockPrisma.ad.findUnique.mockResolvedValue({
      id: "ad-1", type: "LINK", content: "example.org", status: "ACTIVE", cpc: 0.005, remaining: 0.001,
    });
    const response = await call();
    expect(response.status).toBe(410);
    expect(mockPrisma.adClick.update).not.toHaveBeenCalled();
  });
});
