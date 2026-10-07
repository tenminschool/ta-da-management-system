# Transportation Allowance (TA) & Per-Diem Management System

A fully digital TA, Per-Diem, accommodation and travel-management module for PeopleOps, built to the
PRD in `Transportation Allowance (TA) & Per-Diem Management System.docx`. A Bangla summary of the
requirement is in [REQUIREMENT-BANGLA.md](REQUIREMENT-BANGLA.md).

**The database is PostgreSQL** — every record lives in `ta_da_*` tables. Nothing is stored in, or read from, a spreadsheet.

## Run it

```bash
npm install
npm run db:setup  # creates the ta_da_* tables and default policy rows (safe to re-run)
npm run dev       # http://localhost:3000
```

Production (self-hosted): `npm run build && npm start`.

## Deploying to Vercel

The API is a plain Express app in `server/app.ts` that knows nothing about how
it is served — `server.ts` wraps it with Vite for local development, and
`api/index.ts` exports it as a Vercel function, so Vite never ends up in the
serverless bundle.

1. Import the repo in Vercel. `vercel.json` already sets the build command
   (`vite build`), the output directory (`dist`) and the rewrites — `/api/*`
   goes to the function, everything else to the SPA.
2. Add these environment variables under **Settings → Environment Variables**:

   | Variable | Purpose |
   |---|---|
   | `DATABASE_URL` | PostgreSQL connection string (`…?sslmode=require`). Tables are prefixed `ta_da_`. |
   | `SESSION_SECRET` | A long random string that signs session tokens. Required in production. |
   | `VITE_TENMS_CLIENT_ID` | Public client id for "Login with 10 Minute School". |
3. Deploy, then open the app and sign in. The tables are created on first use; `npm run db:setup`
   creates them ahead of time.

Request numbers are allocated under a Postgres advisory lock, so several serverless instances can
file claims at the same moment without ever being issued the same number.

## Sign in

Sign-in is "Login with 10 Minute School". The server verifies the access token with the provider and
builds the session from that account's own 10MS record (`/v1/admin/me`):

| App field | 10MS field |
|---|---|
| employee id | `employee_id` |
| name, email | `name`, `username` |
| designation | `current_hr_position` |
| department | `department` |
| band | worked out from the HR position (A, B, C1, C2, D, E) |
| line manager | `supervisor` (looked up in the 10MS directory) |
| payment number | `phone_number` |

Admin, HR and Finance roles are granted by email in **Configuration → Roles** and stored in the
`ta_da_role_grants` table; `fahad@10minuteschool.com` is always an admin, and `DEFAULT_ADMIN_EMAILS`
adds more.

## Database tables — one row per record

Created and topped up automatically on first use (or by `npm run db:setup`): every tab below is
a `ta_da_<name>` table whose columns are the headers in `server/schema.ts`.

| Tab | What it holds |
|---|---|
| `Requests` | **One row per claim.** Trips, team members, document links, payment details and advance/settlement are columns on that row — never extra rows |
| `Approvals` | **One row per claim**, with a column group per desk: `ManagerStatus / ManagerBy / ManagerAt / ManagerRemarks`, then Admin, Finance, Payment, and the advance HR / Dept-Head steps |
| `Config` | Rates, limits and thresholds as key/value |
| `BandPolicy` | Per-band transport lists, outside-city rates, accommodation limit, flight and car-pool eligibility |
| `Lists` | Every dropdown in one tab, keyed by `ListName` — City, TransportMode, WorkedAt, DualWorkstation, PaymentMethod, DocumentType, ApprovalStage |

Repeating data is packed one item per line inside a single cell, `field | field | field`:

```
Trips         2026-09-07 | Bus | Dhaka | Sylhet | 1200 |
TeamMembers   EMP-1002 | Nusrat Jahan | Academic | Content Producer | F
DocumentLinks https://drive.google.com/file/d/…/view
              https://drive.google.com/file/d/…/view
```

## Works on a phone

The whole app is built mobile-first, because most claims get filed from a phone right after the
trip:

- Phones get a **bottom tab bar** for the main screens and a slide-in drawer for the rest; the
  workspace switch (My Claims / Approvals) sits permanently under the header.
- Every list renders as **tappable cards on phones** and as a full table from tablet width up — no
  pinching or sideways scrolling to read a claim.
- Inputs are 16px on phones so **iOS does not zoom** on focus, with comfortable tap targets and
  proper date/time control heights.
- Modals open as **bottom sheets** on phones and as centred dialogs on desktop.
- In the request wizard the live calculation sits **above** the form on phones, and the
  Back / Save draft / Next bar is sticky, so the running total and the next step are always visible.

## Documents

The employee picks files from their device — image, PDF, Word, Excel, CSV, anything — and they are
uploaded to the 10 Minute School file service (bucket `10mscdn`, public-read) under
`hq/<employee id>/ta-da`, renamed **`employeeId-lastname-date`** (a second file in the same claim
gets `-2`, and so on). The request stores the resulting file address, so approvers click through
from the claim. Alongside that is a **multi-select** of document types, editable in the `Lists` tab.

The bytes go **straight from the browser to the file service**, authorised with the signed-in
person's own 10MS access token. The server only decides the
name and key and enforces the size limit, so a 50 MB file is never limited by the few megabytes a
serverless request body allows.

If the file service refuses a file, the form shows its own reply and status code.

| Variable | Purpose |
|---|---|
| `MAX_UPLOAD_MB` | Per-file limit, default 50. |
| `UPLOAD_BUCKET`, `UPLOAD_ACL`, `UPLOAD_ENDPOINT` | Where files go. Defaults: `10mscdn`, `public-read`, the 10MS `s3-manager` upload URL. |

## How the policy works

`shared/policy.ts` is the single rule engine. It is pure and imported by **both** the client (to hide
ineligible options and show a live calculation) and the server (which re-runs it on submit and is
authoritative). It reads every number from the sheet — nothing is hard-coded:

- **Transport eligibility** by band, gender and team size. A Band G male sees Rickshaw/Bike/CNG; the
  same band female also sees Car; Band D and above see Rickshaw/CNG/Car. A team of 2 loses Car, a
  team of 3+ regains it. Car for a junior male appears locked with the reason, and unlocks on the
  "pre-approved" toggle.
- **Per-Diem** decided by the system, not the employee: ≥5 hours → BDT 250 and lunch allowance is
  switched off; <5 hours worked through lunch → BDT 150; an office meal or a dual-workstation day
  blocks the duplicate meal claim.
- **Personal vehicle** = total KM × the admin-configured per-km rate.
- **Dual workstation** — a day split across two work locations by schedule (HQ Scheduled Day, SBM,
  Tele Sales, Shooting, Other). TA and Per-Diem both stay claimable, but the day is treated as one
  where the company provided a meal, so the lunch allowance is switched off and no duplicate meal
  claim is possible.
- **Outside city** loads the band's weekday/weekend rate automatically (weekday × rate + weekend ×
  rate), caps accommodation at the band limit per night, blocks flight for non-eligible bands, and
  rejects a rent-a-car under 3 people or flags it above the BDT 6,000 one-way limit.
- **Company arrangement** is blocked under 2 business days' notice with the PRD's exact wording, and
  notifies Administration immediately when valid.
- **Advance** only for outside-city trips over 3 days. Line Manager → HR, and above BDT 10,000 one
  more approval after that — the Department Head derived from the line-manager chain, or
  Administration when there is nobody above the line manager. Settlement is due 3 working days
  after the trip.

Change any of it from **Configuration** in the app — no code change.

## Two workspaces: My Claims vs Approval Desk

A line manager, HR or Finance person is both a claimant and an approver. Those two jobs never share
a screen. The sidebar has a workspace switch (shown only to people who approve something):

| **My Claims** — what you spend | **Approval Desk** — what you decide |
|---|---|
| Dashboard (your own summary cards) | Desk Overview (queue, pipeline, value at your desk) |
| My Requests | Pending Approvals — at your desk right now |
| My Advance | Decided by Me |
| My Payments | Advance Approvals *(HR / Finance / Dept Head)* |
| | Payments *(Finance / Admin)* |
| | All Claims |
| | Configuration *(Admin / HR)* |

The separation is enforced by the API, not just hidden in the UI: `mine*` scopes return only the
signed-in person's own claims, and `desk*` scopes exclude them. A manager's own claim goes to *their*
line manager and never appears in their own approval queue. The pending badge and desk counters are
computed separately from the personal summary cards.

## Workflow

`Employee → Line Manager → Administration → Finance → Payment → Completed`, with Approve / Reject /
Return / Request-more-documents and remarks at every desk. Approvers see what is waiting on them as
a live count on the Approvals tab and on the Pending Approvals item — there is no separate
notification feed. Employees watch a live progress bar and a
per-stage timeline showing who acted, when, and what they said. Finance gets one consolidated screen
(claim, advance adjustment, final payable, document links) plus Bank / bKash / Nagad with
transaction ID. A trip that drew an advance stays at *Paid* until the advance is settled, then
closes to *Completed*.

Each decision overwrites its own column group on the request's single Approvals row, so a returned
and resubmitted claim shows that desk back at *Pending* rather than appending history. `LastAction`
and `LastActionAt` always name the most recent decision.

## Layout

```
server.ts               API + Vite middleware
server/schema.ts        every tab, header and seed row — the single source of truth
server/db.ts            record layer over PostgreSQL, schema creation, request-number lock
server/store.ts         row ↔ record mapping, cell packing, policy loading
server/auth.ts          stateless HMAC session tokens
shared/policy.ts        the rule engine, shared by client and server
shared/types.ts         shared types
scripts/setup-db.ts     create the tables and default policy rows
src/                    React client
```
