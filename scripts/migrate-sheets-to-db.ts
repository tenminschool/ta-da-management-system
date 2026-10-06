/**
 * One-time copy of what is in the Google Sheet into PostgreSQL.
 *
 * Each tab is copied in sheet order, replacing whatever the table holds — which
 * for a fresh database is only the default policy rows. The late-claim unlock
 * columns that sat on the Employees tab are carried into ClaimUnlocks.
 * Employees itself stays in the sheet.
 *
 * Stop people using the app while this runs, then switch the deployment over:
 * anything saved to the sheet after the copy is not seen by the database.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --only=Requests,Approvals
 */

import "dotenv/config";
import { DB_TABS, dbPool, initDatabase, replaceTabRows, tableName } from "../server/db.js";
import { readTab as readSheet } from "../server/sheets.js";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean);

async function main() {
  await initDatabase();

  for (const t of DB_TABS) {
    if (only && !only.includes(t.title)) continue;
    let source: Record<string, string>[];
    try {
      if (t.title === "ClaimUnlocks") {
        source = (await readSheet("Employees"))
          .filter((e) => e.employee_id && (e.claim_unlock_from || e.claim_unlock_exact))
          .map((e) => ({
            employee_id: e.employee_id,
            claim_unlock_from: e.claim_unlock_from || "",
            claim_unlock_exact: e.claim_unlock_exact || "",
          }));
      } else {
        source = await readSheet(t.title);
      }
    } catch (err) {
      console.log(`${t.title.padEnd(16)} not in the sheet — skipped (${(err as Error).message.slice(0, 60)})`);
      continue;
    }
    if (!source.length) {
      console.log(`${t.title.padEnd(16)} empty in the sheet — left as it is`);
      continue;
    }
    await replaceTabRows(t.title, source);
    console.log(`${t.title.padEnd(16)} copied ${String(source.length).padStart(4)} row(s) → ${tableName(t.title)}`);
  }
  await dbPool().end();
}

main().catch((err) => {
  console.error("db:migrate failed:", err.message);
  process.exit(1);
});
