# Transportation Allowance (TA) & Per-Diem Management System

A fully digital TA, Per-Diem, accommodation and travel-management module for PeopleOps, built to the
PRD in `Transportation Allowance (TA) & Per-Diem Management System.docx`. A Bangla summary of the
requirement is in [REQUIREMENT-BANGLA.md](REQUIREMENT-BANGLA.md).

**The database is the Google Sheet** — no other datastore is involved.

## Run it

```bash
npm install
npm run setup     # creates / repairs / migrates the 6 tabs (safe to re-run)
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
2. Add the three environment variables below under **Settings → Environment
   Variables** (Production, Preview and Development).
3. Deploy, then open the app and sign in.

`GOOGLE_PRIVATE_KEY` works whether you paste it with real line breaks or with
literal `\n` — the server normalises both.

### Optional tuning

| Variable | Default | What it does |
|---|---|---|
| `SHEETS_READS_PER_MINUTE` | 150 | Pace of Sheets reads, kept under Google's 300/min |
| `SHEETS_WRITES_PER_MINUTE` | 150 | Same for writes |

### One thing to know about serverless

The rate limiter and the write lock live **inside one process**. Vercel runs
several instances under load, so they do not coordinate. Two protections cover
this: request numbers are re-checked against the sheet after writing and
reissued if another instance took the same one, and the retry/backoff handles
any quota rejection. At ~50 claims a day this is comfortable. If you ever push
far past that, move `Requests` to a real database and keep the sheet as a
mirror — nothing else in the design would change.

Credentials come from `.env` (generated from `test.md`): `GOOGLE_CLIENT_EMAIL`,
`GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`.

## Sign in

Accounts live in the **Employees** tab. Seeded logins all use password `1234`:

| Email | Roles column | Reports to | Band |
|---|---|---|---|
| ariful@10ms.com | `user` | Rakib | G (male) |
| nusrat@10ms.com | `user` | Rakib | F (female) |
| sadia@10ms.com | `user` | Tanvir | E2 |
| tanvir@10ms.com | `user` | Farhana | D |
| rakib@10ms.com | `user` | Farhana | C |
| farhana@10ms.com | `hr` | — | B |
| admin@10ms.com | `admin` | Farhana | D |
| finance@10ms.com · finance2@10ms.com | `finance` | Farhana | D · E1 |
| hr@10ms.com · hr2@10ms.com | `hr` | Farhana | C · E1 |

### Only four roles — the hierarchy is not one of them

The roles column holds one of `user`, `admin`, `hr`, `finance`, and **any number of people can hold
each one**. `user` — raise and track your own claims — is granted to everyone automatically, so the
column only ever names the extra desk somebody sits at: a Finance person's cell reads just
`finance`, never `user,finance`. Admin, HR and Finance all keep the ability to file their own
claims.

Administration can do everything HR can — approve an advance at the HR step,
reject one, and record its settlement — plus its own stage in the claim chain.
Finance alone releases money.

**You never write "manager" or "department head" anywhere.** Both come from the `LineManagerID`
column, which you are maintaining regardless:

- **Line manager** — anyone whose employee ID appears in someone else's `line_manager_id`. They get
  the Approval Desk automatically, and see exactly their own reports' claims. Rakib above is a plain
  `user` and still approves Ariful's claims, because Ariful points at him.
- **Department head** — one level above the approving line manager, i.e. the line manager's own line
  manager. For Ariful (→ Rakib → Farhana) that is Farhana. An advance over the limit always takes a
  second approval after HR: the department head when the employee has one, Administration when
  nobody sits above the line manager. Administration can clear either case, and its approval is the
  last stage.

Move a person to a different manager in the sheet and their approvals move with them on the next
request — nothing else to update.

A shared queue works as you'd expect: a claim waiting on Finance appears in **every** Finance
person's Pending Approvals, whoever opens it first decides it, and from that moment the others can
no longer act on it. The Approvals row then carries **that person's own name** — `FinanceBy`,
`PaymentBy`, `AdvanceHRBy` and so on record who actually clicked, with their own remark beside it.
The same holds for HR on advances and for `PaidBy` on the request row.

## Google Sheet tabs — six, one row per record

Created, formatted and migrated automatically by `npm run setup` (frozen bold headers,
colour-coded tabs, column widths, filters). Re-running it is safe: each tab is re-read under its
own live headers and written back **mapped by column name**, so a column can be added anywhere —
even at the front — without shifting a single value.

| Tab | What it holds |
|---|---|
| `Employees` | `auth_id` (filled in on first SSO sign-in), people, bands, `line_manager_id` (which defines the whole hierarchy), roles, login |
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

Change any of it from **Configuration** in the app, or by editing the sheet directly — no code change.

## Capacity against the Google Sheets quota

Sheets allows 300 reads/min and 300 writes/min per service account. Measured cost (via
`GET /api/admin/stats`, admin only):

| Action | Reads | Writes |
|---|---|---|
| Open the app | 1 | 0 |
| Typing in the form (live calculation) | 0 | 0 |
| Submit a claim | 2 | 2 |
| One approval | 2 | 2 |
| **A whole claim, submit → paid, everyone looking** | **17** | **10** |

For 300 employees with ~50 claims a day that is ~850 reads and ~500 writes spread over a working
day — a couple of calls a minute against a 300/min budget. The quota only matters if many people
act inside the *same minute*, so three things protect it:

- **Caching** — the policy, employee roster and header rows are cached, so browsing and typing cost
  nothing. The live calculation in the form runs entirely in the browser.
- **A token-bucket rate limiter** paces all Sheets traffic below the quota, turning a spike into a
  short queue instead of a wall of errors. Tune with `SHEETS_READS_PER_MINUTE` /
  `SHEETS_WRITES_PER_MINUTE`.
- **Retry with backoff** absorbs anything that still gets a 429.

Verified: 20 people submitting simultaneously and then pushing all 20 claims through every desk
completes with **zero failures**.

Two caveats worth knowing. The rate limiter and the request-number lock are **per process**, so run
a single server instance — on multi-instance serverless they would not coordinate. And if you ever
outgrow this, the fix is to move the `Requests` tab to a real database and keep the sheet as a
mirror; nothing else in the design would change.

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
server/sheets.ts        record layer over the sheet, rate limiting, retry, write lock
server/store.ts         row ↔ record mapping, cell packing, policy and roster loading
server/auth.ts          stateless HMAC session tokens
shared/policy.ts        the rule engine, shared by client and server
shared/types.ts         shared types
scripts/setup-sheets.ts create, repair and migrate the spreadsheet
src/                    React client
```
