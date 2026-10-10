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

7. **Matrix "per-row options"** (max duration, thumbnail, paid default) *(The "paid default" option is gone with deal-making, #28.)* are edited per
   platform×format row and stored on every cell of that row, since a duration cap per
   format×asset-type cell would make the grid unusable. The data model still stores them per cell,
   so finer-grained editing is a pure UI change.
8. **Auto-approval by matrix** requires *every* selected platform×format×asset cell to be
   "Allowed without asking" (and within duration caps); any "Never allowed" cell auto-denies; unset
   cells default to "Ask me". Standing rules always run first, in priority order.
9. **Agreement-mode step**: *(Superseded by #28: approval issues the certificate directly; there is no agreement step.)* manual approvals land in `AGREEMENT_MODE_PENDING`, where the requester
   continues with the default in-app record or either side proposes a legally binding agreement.
   Auto-approved requests skip straight to the in-app record (the spec requires their certificate to
   state the standing rule). A consenter can also issue immediately with the app record.
10. **"Approved in principle"**: if the raw final content file is missing at approval, the grant and
    certificate are issued automatically the moment the file is uploaded (hash-bound), per §7.1.6.
11. **Negotiation offers supersede** rather than edit: *(Superseded by #28: offers and "Mark as paid" are gone.)* every counter-offer is a new versioned row;
    accepting is only possible on the other side's latest open offer. Negotiation is also the
    "Mark as paid" entry point (offer v1 by the consenter).
12. **Contact sharing on deal agreed** *(Superseded by #28: contact details are never shared.)* snapshots both sides' chosen contact fields into the request
    (immutable record of what was revealed and when).
13. **Dossier export** ships as a signed PDF plus signed JSON (`?format=json`) instead of a ZIP —
    same records, zero archive dependency; every export is logged.
14. **Phone OTP is skippable at signup** (verify later from settings); email OTP is required. *(The 2FA rule below is superseded by #32: every account needs 2FA.)*
    2FA (TOTP) is enforced for admins and all consenter team members, as specified — the app
    walks those users through setup on first access.
15. **Report targets**: reports attach to a request (which covers its grant); categories are the
    spec's list. Upheld/dismissed decisions trigger score recalculation of the reported side.
16. **Requester "auto-restriction"**: *(Since #27 the gate reads the asking part of a profile's score; any profile can be asked whatever its score.)* a global admin-configurable minimum score gate blocks
    low-score requesters from sending any requests; consenters can additionally set per-profile
    minimum-score standing rules (auto-deny / whitelist-only).
17. **Watermarking**: consenter-side file previews are visually watermarked in the review UI
    ("CONSENT REVIEW" overlay); binary watermarking of media files is left to a production
    pipeline hook.
18. **Force re-verification** (admin) *(Since #27 it covers every profile the user owns, both halves at once, so they can neither send nor receive until re-verified.)* moves the consenter profiles owned by the user back to
    `UNDER_REVIEW`, hiding them from search until re-verified.
19. **i18n-readiness** is structural (all copy in components/constants, UTC timestamps shown
    local); no extraction framework was added at launch (English only, per spec).
20. **Playwright e2e suite deferred**; Vitest covers the rules engine, canonical JSON signing and
    utility logic. The seeded demo data exercises every state manually. (This matched the chosen
    "full core product" scope.)

## Post-launch owner changes (chat requests after the original spec)

21. **Consent request fee (owner's explicit amendment to §1/§9; first called the "consent price",
    renamed in #25h).** *(Free or ≥ the minimum since #29; the sentences about usage fees negotiated after approval are superseded by #28.)* Each consenter can set a consent request fee (`consentPrice` in code) — the
    fixed fee a requester pays to send them a request. Unlike deal fees, this IS collected
    in-app (alongside the platform fee, in one checkout), held as an `EarningEntry` (see #25h for
    how it splits: 80% to the owner on a yes, 80% refunded otherwise, Consent keeps 20%), and the
    owner's share is paid out by a weekly settlement sweep (`Settlement` batches, one per
    consenter+currency, paid out weekly on Fridays). The original rules here (the fee buys the ask, not
    the answer; non-refundable like all submission fees; an auto-expired request reverses the
    earning; a withdrawn request still pays out) were superseded by #25f and then #25h. Usage fees
    negotiated after approval still never move through Consent — negotiation happens in-app,
    settlement stays direct. Consenters track everything under
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
25. **Fixed by audit follow-up:** *(Two items are superseded: the verification meeting is optional since #33, and the `ESignProvider` is removed with agreements, #28.)* `pg_trgm` is now created by migration (search previously broke
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
25b. **Owner-approved additions (this round):** (a) *Fee by intent* — `ConsentPriceTier`
    overrides the base consent request fee per intent category (News free, Promotion premium);
    resolved at submission from the request's intent, shown on the public profile and review step.
    (b) *Verification API + embed* — `GET /api/v1/verify/{id}` (CORS-open JSON with live
    signature re-verification) and an iframe-able live-status widget at `/embed/{id}`; snippets on
    the badge page. (c) *Public tip-offs* — anyone can report unauthorized use from a public
    profile (no account; IP rate-limited); owners triage at `/c-panel/tipoffs`, admins in the
    reports module. (d) *Playwright e2e suite* covering the spec's 7 flows against a dedicated
    `consent_e2e` database (`npm run e2e:prep`, then `npm run test:e2e`).

25c. **Contact sharing is the owner's choice (owner amendment).** *(Superseded by #28: no contact details are shared.)* Contact details are never
    revealed automatically. The consenter decides, for free and paid approvals alike: a "share my
    contact details" box on the approve form (pre-ticked for paid requests) and on their
    accept-the-fee form (pre-ticked), plus a "Share my contact details" button on the request page
    any time after approval. When a requester accepts the owner's fee offer, nothing is shared until
    the owner chooses; both sides are told so, and the in-app messages remain the fallback for
    arranging payment. Once shared, each side's profile settings decide which fields (email, phone,
    manager) appear, and a `contacts_shared` event records who shared and when. (Messages were
    retired in #25k; the owner now ticks the fields per request, see #25l.)

25d. **Review first, decide last (owner amendment).** *(The answers are now Approve / Ask / Decline; "Set a fee" is gone, #28.)* Request pages show who's asking, what they
    want, the exact files, messages and history before any action; the owner's answer comes last
    in one card (Approve / Set a fee / Ask for changes / Decline) with a single confirm button at the
    end, so typed input can't be lost by pressing a different button. The requester page follows
    the same order with its next steps at the bottom. (Since #25k there are no messages, and "Ask
    for changes" is "Ask".)
25e. **Counter-offer limit (owner amendment).** *(Superseded by #28: there are no counter-offers.)* Each side can send at most 3 counter-offers per
    request (`MAX_COUNTER_OFFERS`, `src/lib/negotiation.ts`); the opening fee is not a counter, and
    revising your own open offer uses one. A side with none left can only accept the other side's
    latest offer or end the request; to keep negotiating, a new request must be raised (closed
    requests link straight to a new one). Enforced in the server actions, shown on both sides as
    "Counter-offers left: you N of 3".

25f. **Consent request fee is held, not kept *("An agreed fee" and DEAL_AGREED are gone, #28.)* (owner amendment, supersedes the "buys the ask" rule
    in #21; the full release and full refund described here are superseded by the 80/20 split in
    #25h).** The consent request fee is collected in-app at submission and held (`EarningEntry`
    HELD). The owner's share becomes theirs the moment they say yes (approval, an automatic yes from
    their terms, or an agreed fee: DEAL_AGREED and every later approved state) and goes out in the
    weekly payout. Any ending without a yes refunds the requester's share (DENIED, CLOSED, WITHDRAWN,
    EXPIRED_NO_RESPONSE, including withdrawals and walk-aways by either side). Once released it stays
    with the owner even if the deal later falls apart. The platform fee is never refunded. One function,
    `syncConsentPrice` (`src/lib/escrow.ts`), runs after every decision and in the job sweep, so a
    missed call is caught on the next tick.
25g. **Logic audit (owner request).** A six-area audit for back-to-front flows confirmed 56 issues
    (pay before learning a request was impossible, decide before seeing the evidence, competing
    buttons that lose typed input, dead ends, permission gaps, destructive actions without
    confirmation). All were fixed; see the commit history for the per-area detail.
25h. **Consent request fee: rename and 80/20 split *("An agreed fee" is gone, #28; the platform fee is 20% of the consent request fee since #30.)* (owner amendment, supersedes the full release
    and full refund in #25f).** The fixed fee a requester pays to send an owner a request is the
    "consent request fee" in everything users see; "ask price", "consent price" and "ask fee" are
    retired. Consent's own charge on each request is the "platform fee", never "request fee" or
    "per-request fee" (which would now collide). Code identifiers, DB fields, form input names and
    URLs keep their old names (`consentPrice`, `ConsentPriceTier`, `perRequestFee`,
    `syncConsentPrice`). The fee is still held until the owner answers, but it now splits. On a yes
    (approval, an automatic yes by their terms, or an agreed fee) 80% goes to the owner and is paid
    out weekly on Fridays. On any ending without a yes (declined, no answer in time, withdrawn,
    ended by either side) 80% is refunded to the requester. Consent keeps 20% either way, and the
    platform fee is never refunded. The shares live in one place: `OWNER_SHARE`, `REFUND_SHARE` and
    `splitConsentFee()` in `src/lib/escrow.ts`. `EarningEntry.amount` is the owner's 80%,
    `EarningEntry.grossAmount` the full fee paid (rows without it fall back to the payment amount,
    or amount / 0.8), and `Payment.refundedAmount` the 80% actually refunded (with `refundedAt` and
    `refundRef`). Every screen shows numbers from these rows, never hard-coded amounts. The
    migration `20261010090022_consent_fee_80_percent_split` moved held and unpaid earnings to the
    80% share; earnings already paid out and refunds already made keep their full amounts.

25i. **7-day request window (owner amendment, replaces the answer-only SLA and the separate
    negotiation-idle timeout).** *(Since #28 `OPEN_STATUSES` is SUBMITTED, PENDING, CHANGES_REQUESTED and APPROVED_IN_PRINCIPLE; offers, agreement steps and meetings no longer exist, and `negotiationIdleDays` is removed from settings.)* Every open request (`OPEN_STATUSES`: sent, pending, in
    negotiation, asked, deal agreed, approved in principle, agreement steps) expires a fixed number
    of days after its last action from either side: Admin → System settings → "Request window
    (days)" (`slaDays`, 7 by default). The last action is read from what actions leave behind,
    not from a timer each action must remember to reset: the latest of submission, any person's
    timeline event (owner, requester or admin side; system events such as reminders and refunds
    don't count), an offer, an upload or an old message (`lastActivity()` / `requestWindows()` in
    `src/lib/request-window.ts`). So answering, an offer or counter, an Ask, answering an Ask, an
    upload, an agreement step and scheduling, moving or cancelling a meeting all start a fresh
    window. Both sides see "Expires {date} unless someone acts" in the request header and at the
    top of the Timeline, in the viewer's own time zone. The sweep (`requestWindowSweep` in
    `src/lib/jobs.ts`) keeps `slaExpiresAt` in step for lists, and sends one "expires soon"
    reminder per window, when under 48 hours remain, to the side whose move it is (`waitingOn()`;
    both sides when either can act; `remindedAt` marks it). On expiry: if it was waiting on the
    owner it becomes EXPIRED_NO_RESPONSE (platform fee forfeited, counts against the owner's score,
    as before); otherwise it becomes CLOSED with closedReason "No action for 7 days" (no score
    change). Either way `syncConsentPrice` runs: before a yes, 80% of the consent request fee goes
    back to the requester; after a yes the owner's share stays theirs. The platform fee is never
    refunded. Both sides are notified. The negotiation-idle setting (`negotiationIdleDays`) is no
    longer read and no longer shown in admin settings; the key may linger in stored settings.
25j. **Request limits (owner amendment).** *("A fee" is no longer an answer, #28. Since the onboarding change, the limit is also chosen at onboarding.)* Owners set, under Profile settings → Request limits:
    how many requests may wait for their answer at once (`maxOpenRequests`; SUBMITTED and
    PENDING count; any answer, whether a yes, a fee, an Ask or a no, frees the place, and an
    answered Ask comes back as waiting), and
    optional limits on new requests in any 24 hours, 7 days or 30 days (`dailyRequestLimit`,
    `weeklyRequestLimit`, `monthlyRequestLimit`, counted by `submittedAt`). An empty box means no
    limit; anything else must be a whole number from 1 to 10,000, checked on the server before
    anything saves. While any limit is reached, new requests are paused (`requestCapacity()` /
    `evaluateCapacity()` in `src/lib/capacity.ts`). Requesters are stopped before any charge and
    see one plain sentence saying why and when it opens again (`pausedMessage()`); on the public
    profile that sentence replaces the "Request consent" button, and the rest of the profile stays
    visible. The owner sees a "New requests are paused" banner on their panel home with the
    reasons and links to the requests waiting and to the limits, and settings shows the live state
    ("Taking new requests" or "Paused: {reasons}, opens again {date}"). The owner's team is
    notified once when the profile becomes paused: when a new request reaches a limit, or when a
    limit is lowered below the current count in settings. Pausing is not a penalty (no score
    change) and requests already sent carry on. It reopens by itself: time limits as old requests
    age out of the rolling window, the waiting limit as the owner answers.
25k. **Ask replaces messages (owner amendment, supersedes the in-app messages in #25c/#25d).** *(The line about pointing at contact details is superseded by #28.)*
    The Messages card and message form are gone from both request pages and the practice copy. The
    owner's "Ask for changes" option is now "Ask", for a question or a change alike: one field,
    "What do you want to ask or change?", sent with "Send". It still sets CHANGES_REQUESTED and logs
    `changes_requested` with `{ note }`. The requester must answer in writing ("Your answer") and
    may, in the same step, update their plan and/or upload a new file; sending puts the request
    back to the owner (PENDING) and logs `ask_answered` (requester side, `{ answer }`). The owner
    sees "You asked: …" and "They answered: …" above their decision, and the Timeline shows both.
    Every "use the messages to arrange payment" line now points at sharing contact details
    instead. Old `RequestMessage` rows stay in the database for the record but aren't shown.
25l. **Contact choices and meetings (owner amendment, extends #25c).** *(Superseded by #28: contact choices, request meetings and calendar invites are removed.)* *Contact choices:* when
    approving, and when sharing later, "Share my contact details" lists Email, Phone, Address and
    Manager/agency, each with its actual value; a field with no value is shown disabled with "add
    it in settings". The ticks start from the profile's share flags. Only ticked fields that have a
    value go into the request's contact snapshot (`revealContacts(requestId, sharedBy, fields)`,
    keys `name, email, phone, address, manager`); the requester's half follows the requester's
    own share flags. Profiles gained an address (`contactAddress`) and a "Share address" switch
    (`shareAddress`, off by default), editable in owner settings and consenter onboarding (and on
    the requester side's contact settings). *Meetings:* either side can schedule one meeting per
    request while it is in play or approved (`MEETING_STATUSES`); the owner can also do it from
    "Also schedule a meeting" on the approve form. It has a date and time in the scheduler's own
    time zone (sent from their browser), a length, how (video link, phone, or in person plus a
    place) and a note. It is stored once (`RequestMeeting`: UTC start and end plus the scheduler's
    zone) and shown on both request pages in each viewer's local time. It goes into both people's
    calendars: each person gets their own calendar invite (.ics) listing only themselves, so
    scheduling never reveals contact details the owner didn't share, and the card offers Add to
    Google Calendar, Outlook and .ics (`/api/meetings/{id}/ics`, members of either side only).
    Either side can move it (same calendar entry, next SEQUENCE) or cancel it (confirmed first; a
    CANCEL invite goes out). Scheduling, moving and cancelling are timeline events, notify the other
    side and count as actions for the window (#25i). Who may: on the owner side OWNER, canApprove or
    canNegotiate; on the requester side anyone but a VIEWER. The calendar provider is a mock that
    emails the .ics (`src/lib/providers.ts`); Google Calendar / Microsoft Graph plug into the same
    `CalendarProvider`, keyed by the same uid so updates replace the entry.

26. **Known remaining gaps (deliberate, in priority order for production):** *(Since #25b the Playwright suite exists; DocuSign and negotiation scope diffs are moot after #28.)* Playwright e2e suite
    (7 spec flows); real provider adapters (Stripe/Razorpay/Resend/Twilio/S3/DocuSign) behind the
    existing interfaces; admin read-only impersonation; relationship-wide dossier export;
    structured negotiation scope diffs; score time-decay and admin-editable band thresholds;
    encryption-at-rest for uploaded identity documents (currently private storage + hashed
    identifiers); queued email/PDF; full i18n extraction. Goodwill credits are issued as 100%%
    single-use coupons rather than a separate credit ledger.

## One equal account (owner pivot)

The product owner: "I don't want a difference in both account types. Every account created is
same and equal where everyone has option to receive and send consent." And: "The consent is
received and the matter is closed."

27. **Equal accounts: every profile is a pair (supersedes the two account types).** There is one
    kind of account. Sign-up → email/phone OTP → 2FA → one onboarding form at `/onboarding`
    (`/onboarding/consenter` and `/onboarding/requester` redirect there) → one ID check → the
    profile can send and receive. In the database a profile is a `ConsenterProfile` (canonical id:
    public page, terms, consent request fee, limits, earnings, receiving) plus its sending half, a
    `RequesterProfile` with `consenterId` (requests sent, payments, membership). They are created
    together in one transaction with OWNER seats in both member tables and the ID document linked to
    both; the shared fields (name, legal name, country, status, approval date) are copied with
    `syncPair`, team changes with `mirrorMember` / `removeMember` (`src/lib/profiles.ts`). Old
    unpaired rows are paired on first use (`ensureAsker`, `ensureProfileFor`). Keeping both tables
    (rather than merging them) left requests, payments, earnings, rules and lists untouched.
    Brands and shows keep team profiles (roles OWNER, MANAGER with flags, VIEWER; managers can send);
    a person can add another profile via `/onboarding?new=1`, and the switcher only appears when
    they belong to more than one. People see **one Consent Score** per profile, `profileScore()`:
    the average of how it answers (`ConsenterProfile.score`) and how it asks
    (`RequesterProfile.score`); score gates and standing rules still read the asking part, and
    admins can correct either part. `/c/<slug>` is the one public profile; `/r/<slug>`
    redirects there permanently. The directory and Find list every verified profile
    (`searchProfiles`), except your own ("This is your profile."). Admin has one ID-check queue,
    `/admin/consenters` ("Profiles"); `/admin/requesters` and its detail pages redirect to the
    paired profile. The admin RBAC module for ID checks is `consenters`; the retired `requesters`
    key is still honoured when reading stored roles and is dropped on the next save.
28. **No deal-making, paperwork, contact sharing or meetings (supersedes #9, #11, #12, #25c, #25d's
    "Set a fee", #25e, #25l and the deal parts of #21, #25f, #25h, #25i–#25k).** Removed completely:
    fee negotiation and counter-offers ("Set a fee", usage fee, agreed fee, `NegotiationOffer`,
    statuses IN_NEGOTIATION and DEAL_AGREED), the legal agreement option (agreement mode, drafting,
    upload, e-signature, `Agreement`, `AgreementSignature`, `AgreementTemplate`, statuses
    AGREEMENT_MODE_PENDING and LEGAL_AGREEMENT_PENDING, the admin agreement-templates page and the
    e-signature setting), sharing contact details (email, phone, address, manager), and scheduling
    meetings between the two people (`RequestMeeting`, calendar invites). The lifecycle is: Draft →
    sent (free) or paid → Pending → Approve (optionally narrowing the scope or adding a short
    written condition that is not about money) / Ask / Decline, or Withdraw by the asker. One
    helper, `approveAndIssue()`, handles every yes: the certificate is issued at once when the final
    content file is uploaded, otherwise the request waits in APPROVED_IN_PRINCIPLE until it is.
    Once the certificate is issued, the matter is closed. Certificates issued before keep their
    signed `fee` and `agreementMode` fields (payloads are never rewritten, or the seal would
    break), but no page, PDF or API response shows them. Timeline events left by removed features
    are skipped. Admin email/SMS message overrides moved to "Pages & messages" (`/admin/cms`).
29. **Consent request fee: free or at least about ₹100, in the currency the profile picks.** The
    fee stays (held, 80/20, #25h) but is optional: `consentPrice` null means free to ask. A paid
    fee must be at least the minimum for its currency, from the admin-editable `Currency` table
    (seeded from `DEFAULT_CURRENCIES`: INR 100, USD 1.20, EUR 1.10, GBP 0.95, AED 4.40, SGD 1.55,
    CAD 1.65, AUD 1.80); `consentFeeProblem()` / `parseConsentFee()` in
    `src/lib/currency-rules.ts`. Per-use fees (`ConsentPriceTier`) stay; each is free (0) or at
    least the minimum. The currency defaults from the profile's country. Fee and receive limits
    are chosen at onboarding; per-use fees are set later in Profile → fee & limits.
30. **Platform fee: 20% of the consent request fee (replaces the flat per-request platform fee).**
    The asker pays it on top of the consent request fee, in the same currency, on the same single
    checkout (`requestCharges()` / `PLATFORM_SHARE` in `src/lib/platform-fee.ts`). Coupons discount
    the platform fee only; tax (the payer's country, `PriceConfig.taxRate`) applies to the platform
    fee, never to the consent request fee. It is never refunded. A free ask has no platform fee and
    no checkout at all: "Send request" sends it at once. So both sides give Consent the same 20%.
31. **Membership: ₹1,000 a year, the same for every account, free for now (replaces the requester
    onboarding fee and yearly subscription).** Every profile, team profiles included, has the same
    yearly membership (`PriceConfig.membershipFee` per country: IN ₹1,000, DEFAULT USD 12; tax as
    configured). An admin switch (`membershipFeeOn`, off by default) turns it on; until then nobody
    pays and every verified profile can send. Once on, it is needed to send
    (`canSend()` in `src/lib/membership.ts`), never to be asked; paying extends
    `membershipEndsAt` by a year from the later of now and the current end.
32. **2FA for everyone (supersedes the 2FA part of #14).** TOTP 2FA is required for every account
    before onboarding and for every profile panel, not only for teams that receive requests. The
    app walks people through setup on first access.
33. **The verification call is optional (supersedes the mandatory meeting in #25).** The ID check
    rests on the documents, the channels and duplicate detection. An admin may still schedule a
    video or in-person verification call (`VerificationMeeting`) when the documents need a closer
    look and record its outcome, but approval no longer requires one. A possible duplicate (legal
    name, document number or channel) still blocks approval until it is cleared with a reason.
34. **Onboarding is strictly mandatory (owner's later decision; tightens #27 and #29).** The product
    owner: "All things are mandatory. Incomplete profiles can't be onboarded." The one `/onboarding`
    form requires, with HTML `required` and server checks that name the missing field
    (`readApplication()` in `src/app/(app)/onboarding/application.ts`): (1) the kind of profile,
    (2) country, (3) legal name, (4) public display name, (5) what you do, (6) "About you" of at
    least 40 characters, (7) a profile photo (an image), (8) the ID document: its type, its number
    (stored only as a hash for duplicate checks) and the file, (9) at least one channel with
    platform, an http(s) link and a follower count (up to 6), (10) the creator type (defaulting from
    the kind of profile) and (11) the declaration ("This is me / I am authorised to represent this
    name"). The only optional field is "Also known as", because many people have none. Two more
    choices are required and explicit (radios, no silent default): the **consent request fee**
    (a currency, then Free or an amount of at least that currency's minimum, #29) and **how many
    requests they can receive** (Unlimited, or a number per day, week or month; requests pause
    when the limit is reached and resume as they answer). So an incomplete profile never reaches
    the admin queue. Email and phone are still proven at sign-up and 2FA set up before the form
    (#32); the admin's "More info needed" reply stays for documents that don't match. Per-use fees
    (`ConsentPriceTier`) are the one fee setting left for later, in Profile → fee & limits, with
    a nudge on Home after approval until the profile sets them or dismisses it.

