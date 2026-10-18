-- Read-only checks for the payments audit. SELECT only; run in Supabase SQL editor.
SELECT status, type, count(*), sum(amount) FROM "Transaction" WHERE type IN ('WITHDRAWAL','OWNER_WITHDRAWAL') GROUP BY 1,2 ORDER BY 1,2;
SELECT "accumulatedOwnerProfit", "updatedAt" FROM "PlatformSettings" WHERE id = 1;
SELECT sum(balance) AS users_total, max(balance) AS max_balance FROM "User";
SELECT id, "ownerId", "ownerBalance", "pendingBalance", "totalRevenue" FROM "Bot" ORDER BY "totalRevenue" DESC LIMIT 20;
SELECT type, status, count(*), sum("usdValue") FROM "TonTransaction" GROUP BY 1,2 ORDER BY 1,2;
SELECT id, "userId", amount, status, "created_at" FROM "Transaction" WHERE status IN ('PENDING','PENDING_AUDIT') ORDER BY "created_at" LIMIT 50;
SELECT count(*) AS stuck_pending_earnings FROM "Transaction" WHERE type='CREATOR_EARNING_PENDING' AND status='PENDING' AND "created_at" < now() - interval '48 hours';
SELECT count(*) AS escrowed_over_7d FROM "StoreOrder" WHERE status='ESCROWED' AND "escrowedAt" < now() - interval '7 days';
