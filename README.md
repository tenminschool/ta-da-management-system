# TA & Per-Diem Management System — Cloudflare

The same app as the Vercel version, running on **Cloudflare Workers**:

- the React client (`src/`) is built by Vite into `dist/` and served by Workers Assets;
- the API (`server/app.ts`, an Express app) runs in a Worker (`worker/index.ts`) with Node compatibility;
- data lives in PostgreSQL (tables prefixed `ta_da_`), reached directly or through Cloudflare Hyperdrive.

This is the `main` branch. The `stage` branch is the Vercel version.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars     # then fill in DATABASE_URL
npm run dev                        # builds the client and starts the Worker on http://localhost:8787
```

For hot reload while working on the client, run `npm run dev` in one terminal and `npm run dev:client` in another, and open the Vite address it prints (it forwards `/api` to the Worker).

`VITE_TENMS_CLIENT_ID` (the 10MS sign-in client ID) is read from `.env` at build time.

## Deploy

### Option A — connect the GitHub repo (recommended)
Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick this repo and the `main` branch.

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Then, under **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `DATABASE_URL` | Secret | the PostgreSQL connection string |
| `APP_URL` | Variable | the app's address, e.g. `https://ta-da.example.com`, used in email links |
| `VITE_TENMS_CLIENT_ID` | **Build** variable | the 10MS sign-in client ID (Settings → Build → Variables) |

Optional: `ADMIN_EMAILS`, `HR_EMAILS`, `FINANCE_EMAILS`, `POSTAL_MAIL_URL`, `GROUP_ADMIN`/`GROUP_HR`/`GROUP_FINANCE`, `PERMISSION_ADMIN`/`PERMISSION_HR`/`PERMISSION_FINANCE` (see `.env.example`).

### Option B — from your machine
```bash
npx wrangler login
npx wrangler secret put DATABASE_URL
npm run deploy
```
Set `APP_URL` in `wrangler.jsonc` (`vars`) first, and make sure `VITE_TENMS_CLIENT_ID` is in `.env` so the build picks it up.

### Hyperdrive (strongly recommended)
Without it, every request opens a fresh connection to the database, which is slow (about a second). Hyperdrive keeps connections warm.

```bash
npx wrangler hyperdrive create ta-da-db --connection-string="<DATABASE_URL>"
```
Copy the id it prints into `wrangler.jsonc` (uncomment the `hyperdrive` block), then deploy again. The app uses it automatically.

### After the first deploy
- Ask the 10MS team to register the new address (`https://<your-worker>.workers.dev` or your own domain) as an allowed sign-in address for the client ID, or sign-in will fail.
- Open the app once so it creates any missing tables.

## Notes
- Database tables are the same as the Vercel version, so both can point at the same database, or at separate ones.
- `npm run db:setup` creates the tables from your machine.
- Express's body parser does not run on Workers, so `server/app.ts` reads JSON bodies itself, and `wrangler.jsonc` replaces `iconv-lite` with a stub (`worker/stubs/`).
