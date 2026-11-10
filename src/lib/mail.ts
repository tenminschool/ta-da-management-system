import { auth } from "./auth.js";
import type { MailBatch } from "../../shared/types.js";

/**
 * Posts a claim's notification mails to Postal from the browser, with the
 * signed-in person's own 10MS token — the same way uploads reach the file
 * service. Postal's Cloudflare check turns away calls made by a server, so the
 * server only prepares the mails and the browser sends them.
 *
 * Never throws and never holds up the claim: anything that fails is written to
 * the console, and the returned text says what failed ("" when all went out).
 */
export async function sendMails(batch: MailBatch | undefined): Promise<string> {
  if (!batch || !batch.jobs.length) return "";
  const token = await auth.getAccessToken().catch(() => "");
  if (!token) {
    const why = "Emails not sent: your 10MS sign-in token is not available.";
    console.warn("[mail]", why);
    return why;
  }
  const failed: string[] = [];
  await Promise.all(batch.jobs.map(async (job) => {
    try {
      const res = await fetch(batch.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "mail", to: [job.to], cc: [], bcc: [], subject: job.subject, body: job.body, html: true }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[mail] to ${job.to} failed:`, msg);
      failed.push(`${job.to} (${msg})`);
    }
  }));
  return failed.length ? `Emails failed for ${failed.join("; ")}` : "";
}
