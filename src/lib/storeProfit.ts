// Net profit of one online-store order after payment fees, platform commission, shipping, ads and returns. Pure arithmetic; every assumption is
// shown on the page. A returned order: the product goes back to stock (its cost is recovered), shipping is paid both ways, the fixed payment fee
// and the ad cost are lost.
export type StoreInput = {
  price: number;          // selling price per order (what the customer pays for the goods)
  cost: number;           // product cost per order
  shipping: number;       // shipping the store pays per order
  gatewayPct: number;     // payment gateway percentage fee, %
  gatewayFixed: number;   // payment gateway fixed fee per order
  platformPct: number;    // store platform commission, %
  adPerOrder: number;     // advertising spend per order
  returnPct: number;      // share of orders returned, %
  orders: number;         // orders per month
};

export type StoreResult = {
  feesPerOrder: number;
  profitDelivered: number;    // profit of an order that is kept
  lossReturned: number;       // result of an order that is returned (<= 0)
  expectedPerOrder: number;
  netMarginPct: number;       // expected profit / price
  monthly: number;
  maxAdPerOrder: number;      // the ad spend per order at which expected profit is exactly 0 (may be negative)
  breakEvenRoas: number | null; // price / maxAdPerOrder when that is positive
};

const nz = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function storeNetProfit(i: StoreInput): StoreResult {
  const price = nz(i.price), cost = nz(i.cost), shipping = nz(i.shipping), fixed = nz(i.gatewayFixed), ad = nz(i.adPerOrder), orders = nz(i.orders);
  const r = Math.min(100, nz(i.returnPct)) / 100;
  const pct = (Math.min(100, nz(i.gatewayPct)) + Math.min(100, nz(i.platformPct))) / 100;
  const feesPerOrder = price * pct + fixed;
  const profitDelivered = price - cost - shipping - feesPerOrder - ad;
  const lossReturned = -(2 * shipping) - fixed - ad;
  const expectedPerOrder = (1 - r) * profitDelivered + r * lossReturned;
  // ad cost is paid on every order (kept or returned), so it enters the expectation with weight 1
  const maxAdPerOrder = (1 - r) * (price - cost - shipping - price * pct - fixed) + r * (-(2 * shipping) - fixed);
  return {
    feesPerOrder,
    profitDelivered,
    lossReturned,
    expectedPerOrder,
    netMarginPct: price > 0 ? (expectedPerOrder / price) * 100 : 0,
    monthly: expectedPerOrder * orders,
    maxAdPerOrder,
    breakEvenRoas: maxAdPerOrder > 0 ? price / maxAdPerOrder : null,
  };
}
