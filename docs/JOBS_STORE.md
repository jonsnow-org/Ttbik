# Jobs & Store Mini App — escrow and commission

The JOBS_BOT store only accepts purchases through the in-bot escrow flow. Manual/off-platform payment is not offered for store listings.

## Platform commission

- Default commission: **5%**, charged to the seller's gross proceeds only when the escrow is released.
- Configure with `JOBS_STORE_COMMISSION_PERCENT`, a number from `0` to `20` (example: `5`).
- The accepted percentage and amount are recorded against the order when the buyer's funds are reserved. Changing the environment variable later does not alter existing orders.
- A refund returns the full held amount to the buyer and voids the pending commission.
- Existing escrow orders created before commission disclosure (without a fee reservation row) are settled at their original gross amount; no fee is applied retroactively.

The existing `JobsTransaction` ledger stores fee reservation (`PLATFORM_FEE_PENDING`), realized revenue (`PLATFORM_FEE`) and cancelled reservation (`PLATFORM_FEE_VOID`). No new database table or column is required.

## Contact visibility

Store listing/request cards and public shop pages do not reveal the other party's contact details. Contact appears in an order only while the order is funded and in `ESCROWED` status; it is hidden after release or refund.
