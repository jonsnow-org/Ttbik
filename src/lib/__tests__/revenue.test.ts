jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isVerifiedTopUp, ledgerRows, summarize, type RevenueRow } from "@/lib/revenue";

describe("commercial revenue accounting", () => {
  it("does not treat an internal ledger deposit as an external top-up", () => {
    expect(isVerifiedTopUp({ type: "DEPOSIT", status: "COMPLETED", txHash: "charge-1", currency: "USDT" })).toBe(true);
    expect(isVerifiedTopUp({ type: "DEPOSIT", status: "COMPLETED", txHash: "local-1", currency: "internal" })).toBe(false);
    expect(isVerifiedTopUp({ type: "DEPOSIT", status: "PENDING", txHash: "charge-2", currency: "USDT" })).toBe(false);
    expect(isVerifiedTopUp({ type: "DEPOSIT", status: "COMPLETED", txHash: null, currency: "USDT" })).toBe(false);
  });

  it("keeps wallet funding, seller GMV, escrow and internal spend outside platform revenue", () => {
    const rows: RevenueRow[] = [
      { source: "بنرات", category: "platform_sale", currency: "USD", unit: "USD", evidence: "system_recorded", amount: 15, count: 1 },
      { source: "عمولة", category: "platform_fee", currency: "USD", unit: "USD", evidence: "system_recorded", amount: 5, count: 1 },
      { source: "شحن عميل", category: "customer_topup", currency: "USD-equivalent", unit: "USD_EQ", evidence: "provider_reference", amount: 100, count: 1 },
      { source: "شراء من الرصيد", category: "customer_spend", currency: "USD-equivalent", unit: "USD_EQ", evidence: "internal_ledger", amount: 10, count: 1 },
      { source: "حجم البائع", category: "seller_volume", currency: "USD", unit: "USD", evidence: "system_recorded", amount: 80, count: 1 },
      { source: "ضمان", category: "escrow", currency: "USD", unit: "USD", evidence: "system_recorded", amount: 40, count: 1 },
      { source: "طلب غير محصل", category: "pending_sale", currency: "USD", unit: "USD", evidence: "unverified", amount: 7, count: 1 },
      { source: "دفتر قديم", category: "internal", currency: "internal", unit: "RAW", evidence: "unverified", amount: 2500, count: 1 },
    ];
    const report = summarize(30, rows);
    expect(report.grossPlatformRevenueUsd).toBe(20);
    expect(report.platformSalesUsd).toBe(15);
    expect(report.platformFeesUsd).toBe(5);
    expect(report.customerTopupsUsdEq).toBe(100);
    expect(report.customerSpendUsdEq).toBe(10);
    expect(report.sellerVolumeUsd).toBe(80);
    expect(report.escrowOutstandingUsd).toBe(40);
    expect(report.pendingSalesUsd).toBe(7);
    expect(report.internalByCurrency).toEqual([{ currency: "internal", amount: 2500, count: 1 }]);
    expect(report.netProfitComputed).toBe(false);
  });

  it("labels job commissions from internal settlement ledgers as USD-equivalent, not cash", () => {
    const rows = ledgerRows("بوت الوظائف", [
      { type: "PLATFORM_FEE", currency: "internal", status: "COMPLETED", txHash: "fee-1", amount: 0.25, created_at: new Date("2026-11-10T00:00:00Z") },
      { type: "PLATFORM_FEE_PENDING", currency: "internal", status: "PENDING", txHash: null, amount: 0.1, created_at: new Date("2026-11-11T00:00:00Z") },
      { type: "DEPOSIT", currency: "internal", status: "COMPLETED", txHash: "internal-deposit", amount: 10, created_at: new Date("2026-11-12T00:00:00Z") },
    ]);
    expect(rows[0]).toMatchObject({ category: "platform_fee", unit: "USD_EQ", evidence: "internal_ledger" });
    expect(rows[1]).toMatchObject({ category: "pending_fee", unit: "USD_EQ" });
    expect(rows[2]).toMatchObject({ category: "internal", unit: "RAW" });
    expect(summarize(30, rows).grossPlatformRevenueUsd).toBe(0);
    expect(summarize(30, rows).platformRevenueEquivalentUsd).toBe(0.25);
  });
});
