# DECISIONS.md

Judgment calls made where the build prompt left room, per §0 ("pick the sensible default, write it
in DECISIONS.md, and continue").

## Infrastructure & providers

1. **DB-backed job scheduler instead of BullMQ/Redis.** The spec allowed "BullMQ + Redis, or a
   DB-backed queue". Sweeps are idempotent functions (`src/lib/jobs.ts`) run by a worker loop,
   a cron-friendly endpoint (`/api/jobs/tick`) and an admin button. Redis stays in
   docker-compose as the upgrade path.
2. **Mock providers by default** (per project owner's choice): email/SMS write to an `OutboxMessage`
   table visible at `/dev/inbox`; payments use an instant mock checkout. All implement pluggable
   interfaces (`src/lib/providers.ts`) so Resend/Twilio/MSG91/Stripe/Razorpay drop in.
3. **Local-disk file storage** implementing the same shape as an S3 adapter (private files +
   short-lived HMAC-signed URLs via `/api/files`). Swap for S3/R2 pre-signed URLs in production.
4. **OAuth social proof is mocked** with a "Connect via OAuth" button that marks the handle
   verified. Real YouTube/Meta/X/LinkedIn/TikTok OAuth needs app registrations; handles are
   otherwise treated as manual proof for admin review.
5. **Ed25519 keys live in the `Setting` table** for dev; production should use a KMS. Certificates
   verify live on every page load.
6. **PDF generation with pdfkit** (lighter than Playwright-HTML-to-PDF in serverless; kept behind
   `src/lib/pdf.ts` helpers so the renderer can be swapped).

## Product interpretations

7. **Matrix "per-row options"** (max duration, thumbnail, paid default) are edited per
   platform×format row and stored on every cell of that row, since a duration cap per
   format×asset-type cell would make the grid unusable. The data model still stores them per cell,
   so finer-grained editing is a pure UI change.
8. **Auto-approval by matrix** requires *every* selected platform×format×asset cell to be
   "Allowed without asking" (and within duration caps); any "Never allowed" cell auto-denies; unset
   cells default to "Ask me". Standing rules always run first, in priority order.
9. **Agreement-mode step**: manual approvals land in `AGREEMENT_MODE_PENDING`, where the requester
   continues with the default in-app record or either side proposes a legally binding agreement.
   Auto-approved requests skip straight to the in-app record (the spec requires their certificate to
   state the standing rule). A consenter can also issue immediately with the app record.
10. **"Approved in principle"**: if the raw final content file is missing at approval, the grant and
    certificate are issued automatically the moment the file is uploaded (hash-bound), per §7.1.6.
11. **Negotiation offers supersede** rather than edit: every counter-offer is a new versioned row;
    accepting is only possible on the other side's latest open offer. Negotiation is also the
    "Mark as paid" entry point (offer v1 by the consenter).
12. **Contact sharing on deal agreed** snapshots both sides' chosen contact fields into the request
    (immutable record of what was revealed and when).
13. **Dossier export** ships as a signed PDF plus signed JSON (`?format=json`) instead of a ZIP —
    same records, zero archive dependency; every export is logged.
14. **Phone OTP is skippable at signup** (verify later from settings); email OTP is required.
    2FA (TOTP) is enforced for admins and all consenter team members, as specified — the app
    walks those users through setup on first access.
15. **Report targets**: reports attach to a request (which covers its grant); categories are the
    spec's list. Upheld/dismissed decisions trigger score recalculation of the reported side.
16. **Requester "auto-restriction"**: a global admin-configurable minimum score gate blocks
    low-score requesters from sending any requests; consenters can additionally set per-profile
    minimum-score standing rules (auto-deny / whitelist-only).
17. **Watermarking**: consenter-side file previews are visually watermarked in the review UI
    ("CONSENT REVIEW" overlay); binary watermarking of media files is left to a production
    pipeline hook.
18. **Force re-verification** (admin) moves the consenter profiles owned by the user back to
    `UNDER_REVIEW`, hiding them from search until re-verified.
19. **i18n-readiness** is structural (all copy in components/constants, UTC timestamps shown
    local); no extraction framework was added at launch (English only, per spec).
20. **Playwright e2e suite deferred**; Vitest covers the rules engine, canonical JSON signing and
    utility logic. The seeded demo data exercises every state manually. (This matched the chosen
    "full core product" scope.)
