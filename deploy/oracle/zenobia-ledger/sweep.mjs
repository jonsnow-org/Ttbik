// The rule that decides how much of the ledger's balance goes to the owner. Pure, so it can be tested without a network.
// The owner gets what is above a reserve (it covers mints, season posts and refunds), only when nothing is waiting to be minted or refunded,
// only once a day, and only to the one address committed in the repository.
export function sweepAmount({ balance, reserve, min, pendingClaims, unfinishedMints }) {
  if (pendingClaims > 0 || unfinishedMints > 0) return 0n; // a payment may still need a refund or a mint from this balance
  const surplus = balance - reserve;
  return surplus >= min ? surplus : 0n;
}
