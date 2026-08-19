/**
 * bKash's own bulk-disbursement workbook: Finance fills in Wallet No and
 * Principal Amount on the Client sheet, and every other sheet's formulas
 * (fees, the summary, the final upload format) recalculate from those in
 * Excel. Read once and reused — the template file on disk never changes.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAYMENT_TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'assets',
  'payment-template.xlsx',
);

let paymentTemplateBuffer: Buffer | null = null;

export async function paymentTemplate(): Promise<Buffer> {
  if (!paymentTemplateBuffer)
    paymentTemplateBuffer = await readFile(PAYMENT_TEMPLATE_PATH);
  return paymentTemplateBuffer;
}
