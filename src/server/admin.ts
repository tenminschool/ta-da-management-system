/**
 * Shared logic for the admin-configuration routes — split out of the old
 * single Express app.ts. Ported as-is.
 */

import { updateRow, readTab } from './sheets';
import { invalidateEmployees } from './store';

export const EDITABLE_TABS = ['Config', 'BandPolicy', 'Lists', 'Employees'];

export const BLOCK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Opens (or closes, with an empty date) an employee's claim window back to a
 * specific date. Shared by the direct Configuration form and by approving an
 * unlock request — the same write either way.
 */
export async function applyClaimUnlock(
  employeeId: string,
  from: string,
): Promise<boolean> {
  const rows = await readTab('Employees');
  const row = rows.find((r) => r.employee_id === employeeId);
  if (!row) return false;
  const { _row, ...rest } = row;
  await updateRow('Employees', _row, { ...rest, claim_unlock_from: from });
  invalidateEmployees();
  return true;
}

/**
 * Grants (or, with an empty date, revokes) a one-trip exception: unlike
 * applyClaimUnlock's open-ended "from this date on", this only ever covers
 * the exact travel date it names — approving a "Contact HR" request should
 * not leave every other late claim that person might file afterward open too.
 */
export async function applyClaimUnlockExact(
  employeeId: string,
  exact: string,
): Promise<boolean> {
  const rows = await readTab('Employees');
  const row = rows.find((r) => r.employee_id === employeeId);
  if (!row) return false;
  const { _row, ...rest } = row;
  await updateRow('Employees', _row, { ...rest, claim_unlock_exact: exact });
  invalidateEmployees();
  return true;
}
