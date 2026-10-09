# Consent — Likeness & IP Permission Platform

Consent is a platform where **famous people and IP owners** (people, TV shows, movies, brands,
characters) record **platform-wise permissions** for how their name, picture, video references,
voice and other identity assets may be used — and where **creators, news channels, meme pages,
podcasts and media houses** get documented, verifiable approval before publishing.

Every approval produces a **tamper-proof consent certificate**: bound to the SHA-256 hashes of the
exact approved files, signed with the platform's Ed25519 key, verifiable by anyone at a public link.

Consent is **not a payment intermediary** between the two sides — agreed fees are settled directly.
Consent only charges requesters platform fees (onboarding, yearly subscription, per-request).

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
npm run jobs    # background worker: SLA expiry, grant expiry, takedowns, renewals
```

The seed enables the `pg_trgm` extension via migration; if your Postgres user cannot create
extensions, run `CREATE EXTENSION pg_trgm;` as a superuser once.

### Demo logins (password: `Password1!`)

| Email | Role |
|---|---|
| `admin@consent.app` | Super Admin (admin panel at `/admin`) |
| `jane@demo.consent` | Consenter — person (actor) |
| `show@demo.consent` | Consenter — TV show (Nightwatch) |
| `brand@demo.consent` | Consenter — brand (Volt Energy) |
| `clips@demo.consent` | Requester — individual creator (active) |
| `news@demo.consent` | Requester — news channel (active) |
| `pod@demo.consent` | Requester — application pending in the admin queue |

Seeded demo data includes requests in every state (pending with SLA, in negotiation with offers,
changes requested, deal agreed with revealed contacts, denied, auto-expired with forfeited fee,
withdrawn) plus one **issued certificate** with a live verification page, an open breach report and
a raised takedown.

**2FA note:** admin access and consenter panels require TOTP 2FA (per spec). On first access you'll
be walked through a 30-second authenticator setup. **Mock providers:** all email/SMS (including OTP
codes) land in the in-app **dev inbox** (`/dev/inbox`); payments use a mock checkout that settles
instantly. Real adapters (Resend, Twilio, Stripe, Razorpay, S3) plug into the same interfaces via
env vars.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run jobs` | Background worker loop (also: `POST /api/jobs/tick` for cron, or the admin "Run jobs now" button) |
| `npm run db:seed` | Idempotent seed (catalog, pricing, roles, templates, demo data) |
| `npm test` | Vitest unit tests (rules engine, signing, utils) |
| `npx prisma migrate dev` | Apply migrations |

## Where things live

```
prisma/schema.prisma      # full data model (~45 models)
prisma/seed.ts            # catalog + demo data
src/lib/                  # auth, rbac, audit (hash-chained), storage+hashing, signing,
                          # rules engine, score engine, jobs, payments, providers (mock/pluggable)
src/app/(public)/         # home, how-it-works, pricing, directory, public profiles,
                          # certificate verification + file hash checker, CMS pages
src/app/(auth)/           # signup, login, email/phone OTP, TOTP
src/app/(app)/            # dashboard, onboarding, consenter panel (c-panel),
                          # requester panel (r-panel), notifications, settings, dev inbox
src/app/(admin)/admin/    # 15 admin modules with RBAC
src/app/api/              # files (signed URLs), certificates/invoices/dossier PDFs,
                          # badge SVG, jobs tick, data export
scripts/worker.ts         # background sweep loop
```

See `ARCHITECTURE.md` for the ER diagram and flow walkthroughs, and `DECISIONS.md` for every
judgment call made where the spec left room.

## Deployment sketch

Vercel (or any Node host) + managed Postgres (Neon/RDS) + a cron hitting `/api/jobs/tick` every
minute (or run `npm run jobs` as a worker dyno). Swap `LocalDiskStorage` for the S3/R2 adapter and
the mock providers for Resend/Twilio/Stripe/Razorpay. Keep the Ed25519 signing key in a KMS.
