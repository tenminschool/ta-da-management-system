import { useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { api, type ReconcileResult } from "../api.js";
import { Modal, Money, Notice, Spinner } from "./ui.js";

const CONFIDENCE: Record<string, { text: string; cls: string }> = {
  exact: { text: "Exact", cls: "bg-emerald-50 text-emerald-700" },
  close: { text: "Close", cls: "bg-amber-50 text-amber-700" },
  mismatch: { text: "Amount differs", cls: "bg-rose-50 text-rose-700" },
};

/**
 * Finance uploads a bKash/eMoney settlement export instead of clicking
 * "Mark paid" on every claim by hand. The file is matched against every
 * claim waiting on payment — by bKash number first, then by whichever
 * transaction's amount is closest when a number has more than one — and
 * nothing is written until Finance reviews and confirms the list.
 */
export default function PaymentReconcileModal({
  currency = "BDT", onClose, onDone,
}: {
  currency?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{ ok: number; errors: string[] }>({ ok: 0, errors: [] });

  async function onFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
      const res = await api.reconcilePreview(contentBase64);
      setFilename(file.name);
      setResult(res);
      // Exact and close matches are pre-ticked; an amount that's off by more
      // than the tolerance needs a human to look at it first.
      setSelected(new Set(res.matches.filter((m) => m.confidence !== "mismatch").map((m) => m.requestId)));
      setStep("preview");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const picked = result.matches.filter((m) => selected.has(m.requestId));
      const { results } = await api.reconcileConfirm(filename, picked);
      setSummary({
        ok: results.filter((r) => r.ok).length,
        errors: results.filter((r) => !r.ok).map((r) => `${r.requestId}: ${r.error}`),
      });
      setStep("done");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Modal title="Reconcile payments from a settlement file" onClose={onClose} wide>
      <div className="space-y-4">
        {step === "upload" && (
          <>
            <p className="text-sm text-slate-600">
              Upload the bKash/eMoney settlement export (.xlsx) from a payout run. Its rows are matched
              against every claim waiting on Finance for payment, by bKash number and amount — nothing is
              marked paid until you review the matches and confirm.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-10 text-center transition hover:border-brand-300 hover:bg-slate-50">
              {busy ? <Spinner label="Reading file…" /> : (
                <>
                  <Upload size={24} className="text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">Choose a .xlsx file</span>
                </>
              )}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>
            {error && <Notice tone="error" items={[error]} />}
          </>
        )}

        {step === "preview" && result && (
          <>
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{filename}</span> — {result.matches.length} match(es) found.
              Untick anything you don't want to confirm.
            </p>

            {!result.matches.length ? (
              <Notice tone="warn" items={["No bKash numbers in this file matched a claim waiting on payment."]} />
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-10 px-3 py-2" />
                      <th className="px-2 py-2 font-semibold">Claim</th>
                      <th className="px-2 py-2 font-semibold">Employee</th>
                      <th className="px-2 py-2 font-semibold">bKash</th>
                      <th className="px-2 py-2 text-right font-semibold">Expected</th>
                      <th className="px-2 py-2 text-right font-semibold">In file</th>
                      <th className="px-2 py-2 font-semibold">Confidence</th>
                      <th className="px-2 py-2 font-semibold">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.matches.map((m) => (
                      <tr key={m.requestId} className={selected.has(m.requestId) ? "" : "opacity-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={selected.has(m.requestId)}
                            onChange={() => toggle(m.requestId)}
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">
                          {m.requestId}
                          {m.requestStatus === "payment_disputed" && (
                            <span className="ml-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">re-pay</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-slate-600">{m.employeeName}</td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-600">{m.bkashNumber}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-slate-600"><Money value={m.expectedAmount} currency={currency} /></td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-medium text-slate-800"><Money value={m.fileAmount} currency={currency} /></td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE[m.confidence].cls}`}>
                            {CONFIDENCE[m.confidence].text}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-500">{m.receiptNo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!!result.unmatchedClaims.length && (
              <details className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  {result.unmatchedClaims.length} claim(s) waiting on payment weren't in this file
                </summary>
                <ul className="mt-2 space-y-1">
                  {result.unmatchedClaims.map((c) => (
                    <li key={c.requestId}>{c.requestId} — {c.employeeName} — {c.bkashNumber || "no bKash number on file"}</li>
                  ))}
                </ul>
              </details>
            )}
            {!!result.unmatchedFileRows.length && (
              <details className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  {result.unmatchedFileRows.length} payout(s) in the file didn't match a waiting claim
                </summary>
                <ul className="mt-2 space-y-1">
                  {result.unmatchedFileRows.map((r) => (
                    <li key={r.receiptNo}>{r.receiptNo} — {r.bkashNumber} — <Money value={r.amount} currency={currency} /></li>
                  ))}
                </ul>
              </details>
            )}

            {error && <Notice tone="error" items={[error]} />}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn-success"
                onClick={confirm}
                disabled={busy || !selected.size}
              >
                <CheckCircle2 size={16} /> {busy ? "Marking paid…" : `Mark ${selected.size} claim(s) paid`}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <Notice
              tone={summary.errors.length ? "warn" : "info"}
              items={[
                `${summary.ok} claim(s) marked paid from ${filename}.`,
                ...(summary.errors.length ? [`${summary.errors.length} skipped:`, ...summary.errors] : []),
              ]}
            />
            <div className="flex justify-end">
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
