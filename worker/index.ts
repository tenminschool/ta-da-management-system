/**
 * Cloudflare Worker entry point.
 *
 * The API is the same Express app as ever (server/app.ts), run on Workers through Node's HTTP
 * server support (`nodejs_compat`). Static files — the built client in dist/ — are served by
 * Workers Assets without reaching this code; only /api/* does (see "run_worker_first" in
 * wrangler.jsonc).
 */
import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import express from "express";
import app from "../server/app.js";
import { requestPoolMiddleware } from "../server/db.js";

const PORT = 8787;

const worker = express();

// With a Hyperdrive binding the app connects through it (pooled, close to the database);
// without one it connects straight to DATABASE_URL.
worker.use((_req, _res, next) => {
  const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
  if (hyperdrive?.connectionString) {
    process.env.DB_POOL_URL = hyperdrive.connectionString;
    process.env.PGSSLMODE = "disable";
  }
  next();
});

// A Worker cannot reuse a database connection made during another request, so each request gets its own.
worker.use(requestPoolMiddleware);

worker.use(app);
worker.listen(PORT);

export default httpServerHandler({ port: PORT });
