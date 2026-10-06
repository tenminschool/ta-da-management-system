/**
 * Creates the PostgreSQL tables (prefix ta_da_) and fills the empty policy
 * tables with their defaults. Safe to re-run: existing tables and rows are left
 * alone, and any column added to the schema since is added.
 *
 *   npm run db:setup
 */

import "dotenv/config";
import { DB_TABS, dbPool, initDatabase, readTab, tableName } from "../server/db.js";

async function main() {
  await initDatabase();
  for (const t of DB_TABS) {
    const rows = await readTab(t.title);
    console.log(`${tableName(t.title).padEnd(28)} ${String(rows.length).padStart(6)} row(s)`);
  }
  await dbPool().end();
}

main().catch((err) => {
  console.error("db:setup failed:", err.message);
  process.exit(1);
});
