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

## Post-launch owner changes (chat requests after the original spec)

21. **Consent price (owner's explicit amendment to §1/§9).** Each consenter can set a per-request
    "consent price" — what it costs a requester just to ask. Unlike deal fees, this IS collected
    in-app (alongside the platform fee, in one checkout), credited to the consenter as an
    `EarningEntry`, and paid out by a weekly settlement sweep (`Settlement` batches, one per
    consenter+currency, at most every 7 days). Rules: the price buys the ask, not the answer
    (non-refundable like all submission fees); an unanswered request that auto-expires REVERSES the
    earning — no reward for silence; a request withdrawn after submission still pays out (the
    deterrent stands). Usage fees negotiated after approval still never move through Consent —
    negotiation happens in-app, settlement stays direct. Consenters track everything under
    `/c-panel/earnings` (pending balance, per-ask earnings, settlement history + payout details);
    finance admins see all settlements in the payments module. Payouts use the mock provider in
    dev; a real payout rail (Stripe Connect / RazorpayX) plugs in at the settlement sweep.
22. **App invites.** Searching a name that isn't on Consent offers "send a Consent invite":
    demand is counted per normalized name, an optional email delivers the invitation, and inviters
    are notified when the person joins and again when they're verified (`AppInvite` + claim loop).

## Deviations surfaced by the spec-coverage audit (now documented or fixed)

23. **shadcn/ui not used** — the strict-monochrome glass system is hand-rolled on Tailwind
    (`src/components/ui.tsx`, `globals.css`). shadcn's Radix primitives were unnecessary for the
    server-rendered, form-driven UI and would have fought the custom design tokens.
24. **Emails send inline and PDFs render on-demand** rather than through the job queue; the
    sweeps (SLA, expiry, takedowns, renewals, settlements) are the queued work. The unused `Job`
    model is reserved for moving email/PDF work onto the queue later.
25. **Fixed by audit follow-up:** `pg_trgm` is now created by migration (search previously broke
    on a fresh database); coupons are redeemable at onboarding/renewal checkout; login, signup,
    OTP, 2FA and invites are rate-limited (in-memory sliding window — swap for Redis when
    multi-instance); requester VIEWER seats are enforced read-only; the verification meeting must
    be held and passed before an admin can mark a consenter verified; bans/suspensions require a
    reason; requester applications create SocialAccount rows so OAuth proof is reachable; admin
    email/SMS templates now actually override the OTP/signature emails (`src/lib/templates.ts`);
    standing rules expose the format condition in the UI; public profiles render the uploaded
    photo and emit JSON-LD; a cookie notice and skip-to-content links were added; `--color-ink-faint`
    was darkened to meet WCAG AA contrast; an `ESignProvider` interface now backs agreement
    signing with the provider selectable in admin settings.
25b. **Owner-approved additions (this round):** (a) *Price by intent* — `ConsentPriceTier`
    overrides the base consent price per intent category (News free, Promotion premium); resolved
    at submission from the request's intent, shown on the public profile and review step.
    (b) *Verification API + embed* — `GET /api/v1/verify/{id}` (CORS-open JSON with live
    signature re-verification) and an iframe-able live-status widget at `/embed/{id}`; snippets on
    the badge page. (c) *Public tip-offs* — anyone can report unauthorized use from a public
    profile (no account; IP rate-limited); owners triage at `/c-panel/tipoffs`, admins in the
    reports module. (d) *Playwright e2e suite* covering the spec's 7 flows against a dedicated
    `consent_e2e` database (`npm run e2e:prep`, then `npm run test:e2e`).

26. **Known remaining gaps (deliberate, in priority order for production):** Playwright e2e suite
    (7 spec flows); real provider adapters (Stripe/Razorpay/Resend/Twilio/S3/DocuSign) behind the
    existing interfaces; admin read-only impersonation; relationship-wide dossier export;
    structured negotiation scope diffs; score time-decay and admin-editable band thresholds;
    encryption-at-rest for uploaded identity documents (currently private storage + hashed
    identifiers); queued email/PDF; full i18n extraction. Goodwill credits are issued as 100%%
    single-use coupons rather than a separate credit ledger.
