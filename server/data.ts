/**
 * Where the app's records live.
 *
 * With DATABASE_URL set, every tab except Employees is a PostgreSQL table
 * (server/db.ts). Without it the app keeps working from the Google Sheet
 * (server/sheets.ts), so a deployment is never left without data while the
 * database is being connected. The two layers expose the same interface.
 */

import * as db from "./db.js";
import * as sheets from "./sheets.js";

export type Row = db.Row;

export const useDatabase = (): boolean => !!process.env.DATABASE_URL;
const layer = () => (useDatabase() ? db : sheets);

export const apiCalls = useDatabase() ? db.apiCalls : sheets.apiCalls;
export const resetApiCalls = (): void => layer().resetApiCalls();

export const getHeaders = (tab: string) => layer().getHeaders(tab);
export const readTab = (tab: string) => layer().readTab(tab);
export const readTabs = (tabs: string[]) => layer().readTabs(tabs);
export const appendRow = (tab: string, record: Row) => layer().appendRow(tab, record);
export const updateRow = (tab: string, row: number | string, record: Row) => layer().updateRow(tab, row, record);
export const clearRow = (tab: string, row: number | string) => layer().clearRow(tab, row);
export const replaceTabRows = (tab: string, records: Row[]) => layer().replaceTabRows(tab, records);
export const withSheetLock = <T>(fn: () => Promise<T>) => layer().withSheetLock(fn);

/**
 * The late-claim windows an administrator has opened for one person. In the
 * database they have their own table; on the sheet they sit on the person's
 * Employees row, where they always were.
 */
export async function getClaimUnlock(employeeId: string): Promise<{ from: string; exact: string }> {
  if (!employeeId) return { from: "", exact: "" };
  if (useDatabase()) {
    const r = (await db.readTab("ClaimUnlocks")).find((x) => x.employee_id === employeeId);
    return { from: r?.claim_unlock_from || "", exact: r?.claim_unlock_exact || "" };
  }
  const r = (await sheets.readTab("Employees")).find((x) => x.employee_id === employeeId);
  return { from: r?.claim_unlock_from || "", exact: r?.claim_unlock_exact || "" };
}

export async function setClaimUnlock(employeeId: string, change: Row): Promise<boolean> {
  if (!employeeId) return false;
  if (useDatabase()) {
    const row = (await db.readTab("ClaimUnlocks")).find((r) => r.employee_id === employeeId);
    if (row) {
      const { _row, ...rest } = row;
      await db.updateRow("ClaimUnlocks", _row, { ...rest, ...change });
    } else {
      await db.appendRow("ClaimUnlocks", { employee_id: employeeId, claim_unlock_from: "", claim_unlock_exact: "", ...change });
    }
    return true;
  }
  const row = (await sheets.readTab("Employees")).find((r) => r.employee_id === employeeId);
  if (!row) return false;
  const { _row, ...rest } = row;
  await sheets.updateRow("Employees", _row, { ...rest, ...change });
  return true;
}
