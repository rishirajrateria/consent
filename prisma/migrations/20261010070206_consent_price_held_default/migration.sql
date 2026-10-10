-- AlterTable
ALTER TABLE "EarningEntry" ALTER COLUMN "status" SET DEFAULT 'HELD';

-- Ask prices collected for requests that have not had a yes are now held,
-- not owed to the owner: released on approval, refunded otherwise.
UPDATE "EarningEntry" e
SET status = 'HELD'
FROM "ConsentRequest" r
WHERE e."requestId" = r.id
  AND e.status = 'PENDING'
  AND r.status NOT IN ('DEAL_AGREED', 'APPROVED_IN_PRINCIPLE', 'AGREEMENT_MODE_PENDING', 'LEGAL_AGREEMENT_PENDING', 'APPROVED');
