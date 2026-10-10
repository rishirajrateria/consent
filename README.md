# Consent — Likeness & IP Permission Platform

**Ask anyone for consent. Decide who can use yours.** Consent is a platform where people, creators,
shows, brands, news channels and podcasts ask each other for **platform-wise permission** before
using someone's name, picture, video, voice or work, and where everyone sets the terms for their own.

**Every account is the same.** One ID check (documents, channels, one account per person or name;
admin approves once) and the profile can both **send** and **receive** consent requests. Brands
and shows can run a team profile that works the same way; the profile switcher only appears for
people who belong to more than one profile. See `DECISIONS.md` #27. Onboarding is strictly
mandatory: every field (photo, ID type, number and file, at least one channel, the declaration, the
consent request fee and the receive limit) is required, except "Also known as", so an incomplete
profile never reaches the ID-check queue (#34).

Every yes produces a **tamper-proof consent certificate**: bound to the SHA-256 hashes of the
exact approved files, signed with the platform's Ed25519 key, verifiable by anyone at a public link.
Once it's issued, the matter is closed: there is no deal-making, paperwork, contact sharing or
meeting scheduling between the two people (#28).

**Money** (#29–#31). Each profile sets a **consent request fee**: free, or at least about ₹100 in
the currency they choose (per-currency minimums are admin-editable). A paid fee is held until they
answer: on a yes 80% goes to them (paid out weekly on Fridays), otherwise 80% is refunded to the
asker; Consent keeps 20%. The asker also pays a **platform fee** of 20% of the consent request fee,
in the same currency, never refunded. A free ask has no platform fee and no checkout at all.
**Membership** is ₹1,000 a year for every account, switched off (free) for now; when an admin
switches it on, it is needed to send, never to be asked.

Requests move on a **7-day window**: every open request ends 7 days (admin setting) after the last
action from either side, and any action starts a fresh window. Profiles can set **request limits**
(how many may wait for an answer, and per day / week / month); while one is reached, new requests
pause. There is no chat: the person asked can **ask** a question and the asker answers in writing.
See `DECISIONS.md` #25i–#25k.

## Stack

Next.js (App Router, Server Actions) · TypeScript strict · Tailwind CSS v4 · PostgreSQL + Prisma ·
DB-backed job scheduler · pdfkit certificates · Ed25519 signatures · Vitest.

## Quick start

```bash
# 1. Database (or use any Postgres 14+ and set DATABASE_URL)
docker compose up -d postgres

# 2. Environment
cp .env.example .env

# 3. Install, migrate, seed
npm install
npx prisma migrate dev
npm run db:seed

# 4. Run (two terminals)
npm run dev     # app on http://localhost:3000
npm run jobs    # background worker: request-window expiry + reminders, grant expiry, takedowns, payouts
```

The seed enables the `pg_trgm` extension via migration; if your Postgres user cannot create
extensions, run `CREATE EXTENSION pg_trgm;` as a superuser once.

### Demo logins (password: `Password1!`)

Every demo account has one profile that can both ask and be asked.

| Email | Profile |
|---|---|
| `admin@consent.app` | Super Admin (admin panel at `/admin`) |
| `jane@demo.consent` | Jane Carter — person (actor); fee USD 25, News free, Commentary USD 10 |
| `show@demo.consent` | Nightwatch — TV show; fee USD 100 |
| `brand@demo.consent` | Volt Energy — brand; free to ask |
| `clips@demo.consent` | Acme Clips — creator; free to ask |
| `news@demo.consent` | Daily Lens News — news channel; free to ask |
| `pod@demo.consent` | Night Owls Podcast — ID check waiting in the admin queue |

Seeded demo data includes requests across the lifecycle (pending with an expiry window, paid and
held, a free ask, an open Ask, approved in principle, declined, expired, withdrawn and closed with
the 80% refunded, and one request in the other direction: Jane asking Acme Clips) plus one **issued
certificate** with a live verification page, an open breach report and a raised takedown. Payments
match the 80/20 split: a platform fee of 20% of each paid consent request fee, and none for free
asks.

**2FA note:** every account (and the admin panel) requires TOTP 2FA. On first access you'll be
walked through a 30-second authenticator setup. **Mock providers:** all email/SMS (including OTP
codes) land in the in-app **dev inbox** (`/dev/inbox`); payments use a mock checkout that settles
instantly. Real adapters (Resend, Twilio, Stripe, Razorpay, S3) plug into the same interfaces via
env vars.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run jobs` | Background worker loop (also: `POST /api/jobs/tick` for cron, or the admin "Run jobs now" button) |
| `npm run db:seed` | Idempotent seed (catalog, currencies, membership prices, roles, CMS pages, demo data) |
| `npm test` | Vitest unit tests (rules engine, signing, escrow, platform fee, profile pairing, channels, utils) |
| `npm run e2e:prep` then `npm run test:e2e` | Playwright browser tests against the separate `consent_e2e` database |
| `npm run e2e:reset` | Wipe and re-seed `consent_e2e` (tests leave history behind, e.g. upheld reports lower Acme Clips' score; reset every few runs) |
| `npx prisma migrate dev` | Apply migrations |

## Where things live

```
prisma/schema.prisma      # full data model
prisma/seed.ts            # catalog + demo data (createProfilePair: one profile per persona)
src/lib/                  # auth, profiles (the profile pair), rbac, audit (hash-chained),
                          # storage+hashing, signing, rules engine, score engine, jobs,
                          # payments, currencies, platform fee, membership, providers (mock/pluggable)
src/app/(public)/         # home, how-it-works, pricing, directory, public profile (/c/<slug>),
                          # certificate verification + file hash checker, CMS pages
src/app/(auth)/           # signup, login, email/phone OTP, TOTP
src/app/(app)/            # dashboard, onboarding (one ID check), Home (/c-panel), Find,
                          # Requests (received and sent), Profile hub, notifications, settings
src/app/(admin)/admin/    # admin modules with RBAC (one ID-check queue: Profiles)
src/app/api/              # files (signed URLs), certificates/invoices/dossier PDFs,
                          # badge SVG, verification API, jobs tick, data export
scripts/worker.ts         # background sweep loop
```

See `ARCHITECTURE.md` for the ER diagram and flow walkthroughs, and `DECISIONS.md` for every
judgment call made where the spec left room.

## Deployment sketch

Vercel (or any Node host) + managed Postgres (Neon/RDS) + a cron hitting `/api/jobs/tick` every
minute (or run `npm run jobs` as a worker dyno). Swap `LocalDiskStorage` for the S3/R2 adapter and
the mock providers for Resend/Twilio/Stripe/Razorpay. Keep the Ed25519 signing key in a KMS.
