/**
 * Deletes one claim (and its approval row, and any team-claim children) from the database.
 *
 *   npx tsx --env-file=.env scripts/delete-claim.mts TA-2026-000033          # shows what would go
 *   npx tsx --env-file=.env scripts/delete-claim.mts TA-2026-000033 --yes    # deletes it
 */
import pg from "pg";

const [id, flag] = process.argv.slice(2);
if (!id) {
  console.error("Usage: delete-claim.mts <REQUEST_ID> [--yes]");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const { rows } = await pool.query(
    "SELECT request_id, name, status, created_at, linked_to FROM ta_da_requests WHERE request_id = $1 OR linked_to = $1",
    [id],
  );
  if (!rows.length) {
    console.log(`No claim found for ${id}.`);
  } else {
    console.table(rows);
    if (flag !== "--yes") {
      console.log("Nothing deleted. Run again with --yes to delete the rows above.");
    } else {
      await pool.query("DELETE FROM ta_da_approvals WHERE request_id = $1", [id]);
      const res = await pool.query("DELETE FROM ta_da_requests WHERE request_id = $1 OR linked_to = $1", [id]);
      console.log(`Deleted ${res.rowCount} request row(s) for ${id}.`);
    }
  }
} finally {
  await pool.end();
}
