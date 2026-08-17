import { useEffect, useState } from "react";
import {
  ArrowLeft, Banknote, Check, CircleDot, Clock, ExternalLink, FileText, HandCoins,
  Link as LinkIcon, Pencil, RotateCcw, X,
} from "lucide-react";
import { api, type RequestDetail as Detail } from "../api.js";
import type { ApprovalRow, Policy, RequestDraft, SessionUser } from "../../shared/types.js";
import { STATUS_PROGRESS, TRACK_STAGES } from "../../shared/types.js";
import { cfgNum, cfgStr, teamPayoutSplit } from "../../shared/policy.js";
import { Card, Empty, Field, Modal, Money, Notice, ProgressBar, Spinner, StatusBadge } from "./ui.js";

export default function RequestDetail({
  requestId, user, policy, onBack, onEdit, onChanged,
}: {
  requestId: string;
  user: SessionUser;
  policy: Policy;
  onBack: () => void;
  onEdit: (draft: RequestDraft, requestId: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"approve" | "reject" | "return" | "request_docs" | null>(null);
  const [paying, setPaying] = useState(false);
  const [advanceAction, setAdvanceAction] = useState<"approve" | "settle" | "reject" | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeNote, setDisputeNote] = useState("");
  const currency = cfgStr(policy, "CURRENCY", "BDT");

  async function load() {
    setLoading(true);
    try {
      setDetail(await api.request(requestId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />;
  if (error || !detail) return <Notice tone="error" items={[error || "Request not found."]} />;

  const r = detail.request;
  const a = detail.approval;
  const isMine = r.employeeId === user.employeeId;
  // Per-Diem is the only line split evenly per traveller — everything else is
  // a single receipt or a flat amount for the whole group.
  const isTeam = r.travelType === "team" && r.teamMembers.length > 0;
  const perDiemPerHead = isTeam && r.teamSize > 0 ? r.perDiemAmount / r.teamSize : 0;
  // Company-arranged costs are logged per traveller — the requester's own
  // figure plus whatever each team member cost, since one person can differ
  // from the rest (an extra night, say).
  const companyTransportTotal = (r.companyTransportAmount || 0) + r.teamMembers.reduce((s, m) => s + (m.companyTransportAmount || 0), 0);
  const companyAccommodationTotal = (r.companyAccommodationAmount || 0) + r.teamMembers.reduce((s, m) => s + (m.companyAccommodationAmount || 0), 0);
  // Rent-a-car and Flight are trips too, so their cost is already folded
  // into Transportation — listing them again here would look charged twice.
  const lines: [string, number][] = [
    ["Transportation (TA)", r.taAmount],
    ...(isTeam ? [] : [[`Per-Diem${r.perDiemDays > 1 ? ` · ${r.perDiemDays} days` : ""}`, r.perDiemAmount] as [string, number]]),
    ["Lunch allowance", r.lunchAllowance],
    ["Accommodation", r.accommodationAmount],
    ["Other", r.otherAmount],
    ["Company transportation (arranged)", companyTransportTotal],
    ["Company accommodation (arranged)", companyAccommodationTotal],
  ];
  // What the company already paid directly is real trip cost, so it belongs
  // in the total for the record — but it was never owed to the employee, so
  // it must never touch what Finance actually pays out.
  const displayTotalClaim = r.totalClaim + companyTransportTotal + companyAccommodationTotal;

  // The server decides which advance step this person may take — the
  // Department Head is derived from the requester's line-manager chain, so it
  // is not something the client can work out from roles.
  const advanceStep = detail.advanceStep
    ? {
        mode: (detail.advanceStep.action === "settle" ? "settle" : "approve") as "settle" | "approve",
        label: detail.advanceStep.label,
        action: detail.advanceStep.action,
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-base font-bold text-slate-900 sm:text-lg">{r.requestId}</h1>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {r.employeeName} · Band {r.band} · {r.department} · submitted{" "}
              {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}
            </p>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {detail.canEdit && (
            <button className="btn-ghost flex-1 sm:flex-none" onClick={() => onEdit(toDraft(r), r.requestId)}>
              <Pencil size={16} /> Edit & resubmit
            </button>
          )}
          {detail.canAct && ["payment_processing", "payment_disputed"].includes(r.status) && (
            <button className="btn-success flex-1 sm:flex-none" onClick={() => setPaying(true)}>
              <Banknote size={16} /> Mark paid
            </button>
          )}
        </div>
      </div>

      <Card>
        <ProgressBar status={r.status} />
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {TRACK_STAGES.map((stage) => {
            const status = a?.[`${stage.column.toLowerCase()}Status` as keyof ApprovalRow] as string | undefined;
            const by = a?.[`${stage.column.toLowerCase()}By` as keyof ApprovalRow] as string | undefined;
            const at = a?.[`${stage.column.toLowerCase()}At` as keyof ApprovalRow] as string | undefined;
            const done = ["Approved", "Paid"].includes(status || "");
            const current = r.status === stage.key;
            const blocked = ["Rejected", "Returned", "Documents Requested"].includes(status || "");
            return (
              <div
                key={stage.key}
                className={`rounded-xl border p-3 ${
                  blocked ? "border-rose-200 bg-rose-50"
                    : current ? "border-brand-300 bg-brand-50"
                      : done ? "border-emerald-200 bg-emerald-50"
                        : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {blocked ? <X size={14} className="text-rose-600" />
                    : done ? <Check size={14} className="text-emerald-600" />
                      : current ? <Clock size={14} className="text-brand-600" />
                        : <CircleDot size={14} className="text-slate-300" />}
                  <p className={`text-xs font-bold ${
                    blocked ? "text-rose-700" : current ? "text-brand-700" : done ? "text-emerald-700" : "text-slate-400"
                  }`}>
                    {stage.label}
                  </p>
                </div>
                <p className="mt-1.5 text-xs font-semibold text-slate-600">{status || "Not started"}</p>
                {by && <p className="text-xs leading-snug text-slate-500">{by.replace(/<.*>/, "").trim()}</p>}
                {at && <p className="text-xs text-slate-400">{new Date(at).toLocaleString()}</p>}
              </div>
            );
          })}
        </div>
        {r.status === "rejected" && (
          <div className="mt-4"><Notice tone="error" items={[`Rejected — ${lastRemark(a) || "see remarks"}`]} /></div>
        )}
        {r.status === "returned" && (
          <div className="mt-4"><Notice tone="warn" items={[`Returned for correction — ${lastRemark(a) || "see remarks"}`]} /></div>
        )}
        {r.approvedAmount > 0 && (
          <div className="mt-4">
            <Notice
              tone="warn"
              items={[
                `Approved at ${currency} ${r.approvedAmount} instead of the ${currency} ${r.totalClaim} claimed` +
                `${r.approvedAmountBy ? ` by ${r.approvedAmountBy.replace(/<.*>/, "").trim()}` : ""}` +
                `${r.approvedAmountNote ? ` — ${r.approvedAmountNote}` : ""}`,
              ]}
            />
          </div>
        )}
        {r.status === "payment_disputed" && (
          <div className="mt-4">
            <Notice
              tone="error"
              items={[`${r.employeeName} says this payment never arrived${r.paymentAckNote ? ` — ${r.paymentAckNote}` : ""}. Finance is looking into it.`]}
            />
          </div>
        )}

        {/* Only the person who claimed it can say whether the money turned up,
            and until they do they cannot raise another claim. */}
        {isMine && r.status === "paid" && !r.paymentAck && (
          <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:p-5">
            <p className="text-sm font-bold text-indigo-900">Did you get the money?</p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-800">
              Finance paid <Money value={r.paidAmount || r.finalPayable} currency={currency} /> on{" "}
              {r.paymentDate || "—"}{r.transactionId ? ` (ref ${r.transactionId})` : ""}. Tell us whether it
              reached you — you cannot raise a new claim until this one is answered.
            </p>
            {ackError && <p className="mt-2 text-sm font-medium text-rose-700">{ackError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-success"
                disabled={acking}
                onClick={async () => {
                  setAcking(true);
                  setAckError("");
                  try {
                    await api.acknowledge(r.requestId, true);
                    await load();
                    onChanged();
                  } catch (err) {
                    setAckError((err as Error).message);
                  } finally {
                    setAcking(false);
                  }
                }}
              >
                <Check size={16} /> Yes, I received it
              </button>
              <button className="btn-ghost" disabled={acking} onClick={() => setDisputing(true)}>
                <X size={16} /> No, it never arrived
              </button>
            </div>
          </div>
        )}

        {isMine && r.paymentAck === "received" && (
          <div className="mt-4">
            <Notice tone="info" items={["You confirmed this payment was received."]} />
          </div>
        )}
      </Card>

      {disputing && (
        <Modal title="The payment never arrived" onClose={() => setDisputing(false)}>
          <p className="text-sm leading-relaxed text-slate-600">
            Finance will re-check the transfer. Tell them what you can see — the account it should have gone
            to, and whether anything came through at all.
          </p>
          <Field label="What happened?" required>
            <textarea
              className="field min-h-24"
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              placeholder="Nothing reached 01712345678 on 12 September. My bKash statement shows no credit that day."
            />
          </Field>
          {ackError && <Notice tone="error" items={[ackError]} />}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setDisputing(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={acking || !disputeNote.trim()}
              onClick={async () => {
                setAcking(true);
                setAckError("");
                try {
                  await api.acknowledge(r.requestId, false, disputeNote.trim());
                  setDisputing(false);
                  setDisputeNote("");
                  await load();
                  onChanged();
                } catch (err) {
                  setAckError((err as Error).message);
                } finally {
                  setAcking(false);
                }
              }}
            >
              Send back to Finance
            </button>
          </div>
        </Modal>
      )}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Card title="Travel">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row label="Type" value={r.scope === "inside" ? "Inside city" : "Outside city"} />
              {/* Outside-city travel is a route; inside-city is just a city. */}
              <Row
                label={r.scope === "inside" ? "City" : "Route"}
                value={r.scope === "inside" ? r.city : [r.route, r.city].filter(Boolean).join(" — ") || r.city}
              />
              {/* Inside-city trips carry a kind as well as a name; show both
                  when both are there, and never an empty dash for the kind. */}
              <Row
                label="Destination"
                value={[r.destinationType, r.destination].filter(Boolean).join(" — ") || "—"}
              />
              {/* The field is stored as "purpose" either way, but for a 10MS
                  Office visit it actually holds which office — label it that. */}
              <Row
                label={policy.destinationTypes.find((d) => d.value === r.destinationType)?.needs === "office" ? "Office name" : "Purpose"}
                value={r.purpose}
              />
              <Row label="Dates" value={r.scope === "inside" ? r.fromDate : `${r.fromDate} → ${r.toDate} (${r.tripDays} days)`} />
              <Row label="Claim type" value={{ ta: "TA only", perdiem: "Per-Diem only", both: "TA + Per-Diem" }[r.claimType]} />
              {r.scope === "inside" && r.workingHours > 0 && (
                <Row label="Working hours" value={`${r.startTime}–${r.endTime} · ${r.workingHours} h`} />
              )}
              {r.workedAt && <Row label="Worked at" value={r.workedAt} />}
              {r.scope === "outside" && (
                <Row label="Arrangement" value={r.arrangement === "company" ? "Company arrangement" : "Self arrangement"} />
              )}
              {r.transportMode && <Row label="Transport" value={r.transportMode + (r.vehicleType ? ` · ${r.vehicleType}` : "")} />}
              {r.totalKM > 0 && <Row label="Distance" value={`${r.travelFrom} → ${r.travelTo} · ${r.totalKM} km × ${r.fuelRate}`} />}
              {r.dualWorkstation && <Row label="Dual workstation" value={r.dualWorkstationType} />}
              {r.hotelName && <Row label="Hotel" value={`${r.hotelName} · ${r.checkIn} → ${r.checkOut}`} />}
            </dl>
            {r.employeeNote && (
              <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <span className="font-semibold">Employee note: </span>{r.employeeNote}
              </p>
            )}
          </Card>

          {r.teamMembers.length > 0 && (
            <Card title={`Team (${r.teamMembers.length + 1} travellers)`}>
              <ul className="divide-y divide-slate-100 text-sm">
                {r.teamMembers.map((m) => (
                  <li key={m.employeeId} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{m.employeeId} · {m.designation}</span>
                    </span>
                    <span className="text-xs font-semibold text-slate-500">Band {m.band} · {m.department}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.legs.length > 0 && (
            <Card title="Trips claimed">
              <ul className="space-y-2 sm:hidden">
                {r.legs.map((l, i) => (
                  <li key={i} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{l.travelFrom} → {l.travelTo}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{l.travelDate} · {l.mode}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-slate-800">
                        <Money value={l.amount} currency={currency} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Date</th>
                      <th className="py-2 pr-3 font-semibold">Mode</th>
                      <th className="py-2 pr-3 font-semibold">From → To</th>
                      <th className="py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.legs.map((l, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 text-slate-600">{l.travelDate}</td>
                        <td className="py-2 pr-3 text-slate-600">{l.mode}</td>
                        <td className="py-2 pr-3 text-slate-600">{l.travelFrom} → {l.travelTo}</td>
                        <td className="py-2 text-right font-medium text-slate-800">
                          <Money value={l.amount} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {r.arrangement === "company" && (
            <CompanyAmountsCard
              r={r}
              currency={currency}
              canEdit={user.roles.some((role) => ["admin", "hr"].includes(role))}
              onSaved={(updated) => setDetail((d) => (d ? { ...d, request: updated } : d))}
            />
          )}

          <Card
            title="Documents"
            subtitle={r.documentTypes.length ? r.documentTypes.join(" · ") : undefined}
          >
            {!r.documentLinks.length ? (
              <Empty title="No document links shared" />
            ) : (
              <ul className="space-y-2">
                {r.documentLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm transition hover:border-brand-200 hover:bg-slate-50"
                    >
                      <LinkIcon size={15} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{link}</span>
                      <ExternalLink size={14} className="shrink-0 text-brand-500" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Approval trail" subtitle="One row per request — each desk keeps its own decision, remark and timestamp.">
            {!a ? (
              <Empty title="Nothing logged yet" />
            ) : (
              <>
                {/* Phones: a block per desk instead of a five-column table. */}
                <ul className="space-y-2 md:hidden">
                  {trailRows(a, r).map((t) => (
                    <li key={t.stage} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{t.stage}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          ["Approved", "Paid", "Submitted", "Settled"].includes(t.status)
                            ? "bg-emerald-50 text-emerald-700"
                            : t.status === "—"
                              ? "bg-slate-100 text-slate-400"
                              : "bg-amber-50 text-amber-700"
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      {t.by !== "—" && <p className="mt-1 text-xs text-slate-600">{t.by}</p>}
                      {t.at !== "—" && <p className="text-xs text-slate-400">{t.at}</p>}
                      {t.remarks !== "—" && (
                        <p className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{t.remarks}</p>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Stage</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">By</th>
                        <th className="py-2 pr-3 font-semibold">When</th>
                        <th className="py-2 font-semibold">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trailRows(a, r).map((t) => (
                        <tr key={t.stage}>
                          <td className="py-2 pr-3 font-medium text-slate-700">{t.stage}</td>
                          <td className="py-2 pr-3 text-slate-600">{t.status}</td>
                          <td className="py-2 pr-3 text-slate-600">{t.by}</td>
                          <td className="py-2 pr-3 text-slate-500">{t.at}</td>
                          <td className="py-2 text-slate-600">{t.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Claim summary</p>
            </div>
            <div className="space-y-2 px-5 py-4 text-sm">
              {isTeam && r.perDiemAmount > 0 && (
                <div>
                  <span className="mb-1 block text-slate-600">
                    Per-Diem{r.perDiemDays > 1 ? ` · ${r.perDiemDays} days` : ""}
                  </span>
                  <div className="space-y-1 border-l-2 border-slate-100 pl-3">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="text-slate-500">{r.employeeName}{isMine ? " (you)" : ""}</span>
                      <span className="text-slate-700"><Money value={perDiemPerHead} currency={currency} /></span>
                    </div>
                    {r.teamMembers.map((m, i) => (
                      <div key={m.employeeId || i} className="flex justify-between gap-3 text-xs">
                        <span className="text-slate-500">{m.name || `Team member ${i + 1}`}</span>
                        <span className="text-slate-700"><Money value={perDiemPerHead} currency={currency} /></span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between gap-3">
                    <span className="text-xs font-medium text-slate-500">Per-Diem total</span>
                    <span className="font-medium text-slate-800"><Money value={r.perDiemAmount} currency={currency} /></span>
                  </div>
                </div>
              )}
              {lines.filter(([, v]) => v > 0).map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium text-slate-800"><Money value={value} currency={currency} /></span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-3">
                <span className="font-semibold text-slate-700">Total claim</span>
                <span className={`font-bold ${r.approvedAmount ? "text-slate-400 line-through" : "text-slate-900"}`}>
                  <Money value={displayTotalClaim} currency={currency} />
                </span>
              </div>
              {(companyTransportTotal > 0 || companyAccommodationTotal > 0) && (
                <p className="text-xs text-slate-400">
                  Includes <Money value={companyTransportTotal + companyAccommodationTotal} currency={currency} /> the
                  company paid directly — not part of what's payable below.
                </p>
              )}
              {/* Both figures stay on screen: the claim as filed, and what an
                  approver decided to pay instead. */}
              {r.approvedAmount > 0 && (
                <div className="flex justify-between">
                  <span className="font-semibold text-amber-700">Approved amount</span>
                  <span className="font-bold text-amber-700"><Money value={r.approvedAmount} currency={currency} /></span>
                </div>
              )}
              {r.advanceRequested > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Advance adjustment</span>
                  <span className="font-medium text-rose-600">− <Money value={r.advanceRequested} currency={currency} /></span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="font-semibold text-slate-700">Final payable</span>
                <span className="font-bold text-emerald-600"><Money value={r.finalPayable} currency={currency} /></span>
              </div>
              {r.payoutMethod !== "bank" && r.travelType === "team" ? (
                <div className="border-t border-slate-200 pt-2">
                  <span className="text-slate-600">Pay to (bKash) — paid separately per traveller</span>
                  <div className="mt-1 space-y-1">
                    {teamPayoutSplit(r).map((p) => (
                      <div key={p.employeeId} className="flex justify-between gap-3">
                        <span className="text-xs text-slate-500">
                          {p.employeeId === r.employeeId ? `${p.name}${isMine ? " (you)" : ""}` : p.name}
                        </span>
                        <span className="text-right">
                          <span className="font-mono text-xs text-slate-500">{p.bkashNumber || "—"}</span>{" "}
                          <span className="text-sm font-semibold text-slate-800"><Money value={p.amount} currency={currency} /></span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : r.bkashNumber && (
                <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
                  <span className="text-slate-600">Pay to (bKash)</span>
                  <span className="font-mono font-semibold text-slate-800">{r.bkashNumber}</span>
                </div>
              )}
            </div>
          </div>

          {r.advanceRequested > 0 && (
            <Card title="Advance">
              <dl className="space-y-2 text-sm">
                <Row label="Requested" value={`${currency} ${r.advanceRequested}`} />
                <Row label="Approved" value={r.advanceApproved ? `${currency} ${r.advanceApproved}` : "—"} />
                <Row label="Status" value={r.advanceStatus.replace(/_/g, " ") || "pending"} />
                <Row label="Settlement due" value={r.settlementDueDate || "—"} />
                {r.settledAt && <Row label="Settled" value={`${currency} ${r.settledAmount} on ${new Date(r.settledAt).toLocaleDateString()}`} />}
              </dl>
              {advanceStep && (
                <div className="mt-4 grid gap-2">
                  <button className="btn-success" onClick={() => setAdvanceAction(advanceStep.mode)}>
                    {advanceStep.mode === "settle" ? <HandCoins size={16} /> : <Check size={16} />} {advanceStep.label}
                  </button>
                  {advanceStep.mode === "approve" && (
                    <button className="btn-danger" onClick={() => setAdvanceAction("reject")}>
                      <X size={16} /> Reject advance
                    </button>
                  )}
                </div>
              )}
            </Card>
          )}

          {r.paidAmount > 0 && (
            <Card title="Payment">
              <dl className="space-y-2 text-sm">
                <Row label="Amount" value={`${currency} ${r.paidAmount}`} />
                <Row label="Mode" value={r.paymentMode} />
                <Row label="Transaction" value={r.transactionId} />
                <Row label="Date" value={r.paymentDate} />
                <Row label="Processed by" value={r.paidBy.replace(/<.*>/, "").trim()} />
              </dl>
            </Card>
          )}

          {r.policyNotes && (
            <Notice tone="info" title="Policy applied" items={r.policyNotes.split(" | ").filter(Boolean)} />
          )}

          {detail.canAct && (
            <Card
              title="Your decision"
              subtitle={
                r.status === "payment_disputed"
                  ? "The employee says this payment never arrived. Look into it, then record the payment again with a remark."
                  : r.status === "payment_processing"
                  ? "Already approved — record the payment, or send it back if something is wrong."
                  : `This request is at your desk as ${r.status.replace(/_/g, " ")}.`
              }
            >
              <div className="grid gap-2">
                {["payment_processing", "payment_disputed"].includes(r.status) ? (
                  <button className="btn-success" onClick={() => setPaying(true)}>
                    <Banknote size={16} /> Mark paid
                  </button>
                ) : (
                  <button className="btn-success" onClick={() => setAction("approve")}>
                    <Check size={16} /> Approve
                  </button>
                )}
                <button className="btn-ghost" onClick={() => setAction("return")}>
                  <RotateCcw size={16} /> Return for correction
                </button>
                <button className="btn-ghost" onClick={() => setAction("request_docs")}>
                  <FileText size={16} /> Request more documents
                </button>
                <button className="btn-danger" onClick={() => setAction("reject")}>
                  <X size={16} /> Reject
                </button>
              </div>
            </Card>
          )}
        </aside>
      </div>

      {action && (
        <ActionModal
          action={action}
          claimed={r.approvedAmount || r.totalClaim}
          currency={currency}
          requestId={r.requestId}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); load(); onChanged(); }}
        />
      )}

      {paying && (
        <PaymentModal
          requestId={r.requestId}
          needsRemark={r.status === "payment_disputed"}
          amount={r.finalPayable}
          bkashNumber={r.bkashNumber}
          methods={policy.paymentMethods}
          currency={currency}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); load(); onChanged(); }}
        />
      )}

      {advanceAction && (
        <AdvanceModal
          requestId={r.requestId}
          mode={advanceAction}
          action={advanceStep?.action || "hr_approve"}
          currency={currency}
          requested={r.advanceRequested}
          approved={r.advanceApproved}
          limit={cfgNum(policy, "ADVANCE_AUTO_LIMIT", 10000)}
          onClose={() => setAdvanceAction(null)}
          onDone={() => { setAdvanceAction(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

/** The approval trail as plain rows, used by both the phone and table views. */
function trailRows(a: ApprovalRow, r: Detail["request"]) {
  const person = (v?: string) => String(v || "").replace(/<.*>/, "").trim() || "—";
  const when = (v?: string) => (v ? new Date(v).toLocaleString() : "—");
  const rows = [
    {
      stage: "Submitted",
      status: a.submittedAt ? "Submitted" : "—",
      by: r.employeeName,
      at: when(a.submittedAt),
      remarks: a.submittedRemarks || "—",
    },
    ...TRACK_STAGES.map((s) => {
      const k = s.column.toLowerCase();
      return {
        stage: s.label,
        status: (a[`${k}Status` as keyof ApprovalRow] as string) || "—",
        by: person(a[`${k}By` as keyof ApprovalRow] as string),
        at: when(a[`${k}At` as keyof ApprovalRow] as string),
        remarks: (a[`${k}Remarks` as keyof ApprovalRow] as string) || "—",
      };
    }),
  ];
  if (r.advanceRequested > 0) {
    rows.push(
      { stage: "Advance · HR", status: a.advanceHRStatus || "—", by: person(a.advanceHRBy), at: when(a.advanceHRAt), remarks: "—" },
      { stage: "Advance · Dept Head", status: a.advanceDeptHeadStatus || "—", by: person(a.advanceDeptHeadBy), at: when(a.advanceDeptHeadAt), remarks: "—" },
    );
  }
  return rows;
}

function lastRemark(a: ApprovalRow | null): string {
  if (!a) return "";
  return a.paymentRemarks || a.financeRemarks || a.adminRemarks || a.managerRemarks || "";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700">{value}</dd>
    </div>
  );
}

const ACTION_TITLE = {
  approve: "Approve request",
  reject: "Reject request",
  return: "Return for correction",
  request_docs: "Request more documents",
};

/** Company Arrangement trips skip employee-entered transport/hotel figures — HR/Admin logs what it actually cost, for reporting only. */
function CompanyAmountsCard({
  r, currency, canEdit, onSaved,
}: {
  r: Detail["request"];
  currency: string;
  canEdit: boolean;
  onSaved: (updated: Detail["request"]) => void;
}) {
  const isTeam = r.travelType === "team" && r.teamMembers.length > 0;
  // The requester isn't in teamMembers, so they're stitched in as row zero —
  // one line per traveller, since costs genuinely differ within a trip (one
  // person staying an extra night, say).
  const baseline = [
    { employeeId: r.employeeId, name: r.employeeName, transport: r.companyTransportAmount || 0, accommodation: r.companyAccommodationAmount || 0 },
    ...r.teamMembers.map((m) => ({
      employeeId: m.employeeId, name: m.name || m.employeeId,
      transport: m.companyTransportAmount || 0, accommodation: m.companyAccommodationAmount || 0,
    })),
  ];
  const [rows, setRows] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = rows.some((row, i) => row.transport !== baseline[i].transport || row.accommodation !== baseline[i].accommodation);
  const update = (i: number, patch: Partial<{ transport: number; accommodation: number }>) =>
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const entries = rows.map((row) => ({
        employeeId: row.employeeId,
        companyTransportAmount: row.transport,
        companyAccommodationAmount: row.accommodation,
      }));
      const { request } = await api.saveCompanyAmounts(r.requestId, entries);
      onSaved(request);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Company-arranged amounts"
      subtitle="Booked and paid by the company directly — for reporting only, this does not change what's payable to anyone."
    >
      {canEdit ? (
        <>
          {isTeam ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Traveller</th>
                    <th className="py-2 pr-3 font-semibold">Transportation ({currency})</th>
                    <th className="py-2 font-semibold">Accommodation ({currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, i) => (
                    <tr key={row.employeeId || i}>
                      <td className="py-2 pr-3 text-slate-700">
                        {row.name}{row.employeeId === r.employeeId ? " (requester)" : ""}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number" min={0} className="field"
                          value={row.transport || ""}
                          onChange={(e) => update(i, { transport: Number(e.target.value) })}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="number" min={0} className="field"
                          value={row.accommodation || ""}
                          onChange={(e) => update(i, { accommodation: Number(e.target.value) })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Transportation (${currency})`}>
                <input
                  type="number"
                  min={0}
                  className="field"
                  value={rows[0].transport || ""}
                  onChange={(e) => update(0, { transport: Number(e.target.value) })}
                />
              </Field>
              <Field label={`Accommodation (${currency})`}>
                <input
                  type="number"
                  min={0}
                  className="field"
                  value={rows[0].accommodation || ""}
                  onChange={(e) => update(0, { accommodation: Number(e.target.value) })}
                />
              </Field>
            </div>
          )}
          {r.companyAmountsBy && (
            <p className="mt-2 text-xs text-slate-500">
              Last recorded by {r.companyAmountsBy.replace(/<.*>/, "").trim()}
              {r.companyAmountsAt ? ` on ${new Date(r.companyAmountsAt).toLocaleDateString()}` : ""}.
            </p>
          )}
          {error && <div className="mt-2"><Notice tone="error" items={[error]} /></div>}
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" onClick={save} disabled={busy || !changed}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : isTeam ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Traveller</th>
                <th className="py-2 pr-3 font-semibold">Transportation</th>
                <th className="py-2 font-semibold">Accommodation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {baseline.map((row, i) => (
                <tr key={row.employeeId || i}>
                  <td className="py-2 pr-3 text-slate-700">
                    {row.name}{row.employeeId === r.employeeId ? " (requester)" : ""}
                  </td>
                  <td className="py-2 pr-3 text-slate-800">
                    {row.transport > 0 ? <Money value={row.transport} currency={currency} /> : "—"}
                  </td>
                  <td className="py-2 text-slate-800">
                    {row.accommodation > 0 ? <Money value={row.accommodation} currency={currency} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Transportation</span>
            <span className="font-medium text-slate-800">
              {r.companyTransportAmount > 0 ? <Money value={r.companyTransportAmount} currency={currency} /> : "Not recorded yet"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Accommodation</span>
            <span className="font-medium text-slate-800">
              {r.companyAccommodationAmount > 0 ? <Money value={r.companyAccommodationAmount} currency={currency} /> : "Not recorded yet"}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function ActionModal({
  action, requestId, onClose, onDone, claimed, currency,
}: {
  action: keyof typeof ACTION_TITLE;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
  /** What is payable as it stands, so an approver can pay something else. */
  claimed: number;
  currency: string;
}) {
  const [remarks, setRemarks] = useState("");
  const [amount, setAmount] = useState(claimed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = action === "approve" && Number(amount) !== claimed;

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.act(requestId, action, remarks, action === "approve" ? Number(amount) : undefined);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={ACTION_TITLE[action]} onClose={onClose}>
      <div className="space-y-4">
        {action === "approve" && (
          <Field
            label={`Approve amount (${currency})`}
            hint={
              changed
                ? `Claimed ${currency} ${claimed} — you are approving ${currency} ${amount}. The claim itself is not changed; Finance sees both.`
                : "Change this to approve less than was claimed."
            }
          >
            <input
              type="number"
              min={0}
              className="field"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
        )}
        <Field
          label="Remarks"
          required={action !== "approve" || changed}
          hint={
            changed
              ? "Required — the employee, their line manager and Finance all see why the amount changed."
              : action === "approve" ? "Optional — visible to the employee." : "Explain what the employee needs to do."
          }
        >
          <textarea className="field min-h-24" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className={action === "reject" ? "btn-danger" : "btn-primary"}
            onClick={go}
            disabled={busy || (changed && !remarks.trim())}
          >
            Confirm
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({
  requestId, amount, bkashNumber, methods, currency, onClose, onDone, needsRemark = false,
}: {
  requestId: string;
  amount: number;
  /** Re-paying after a dispute: the employee is owed an explanation. */
  needsRemark?: boolean;
  bkashNumber: string;
  methods: string[];
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paymentMode, setPaymentMode] = useState(methods[0] || "Bank");
  const [transactionId, setTransactionId] = useState("");
  const [paid, setPaid] = useState(amount);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.pay(requestId, { paymentMode, transactionId, amount: paid, paymentDate, note });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="space-y-4">
        {bkashNumber && (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-600">Employee's bKash number: </span>
            <span className="font-mono font-semibold text-slate-900">{bkashNumber}</span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment mode" required>
            <select className="field" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              {methods.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label={`Amount (${currency})`} required>
            <input type="number" className="field" value={paid} onChange={(e) => setPaid(Number(e.target.value))} />
          </Field>
          <Field label="Transaction ID" required>
            <input className="field" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} />
          </Field>
          <Field label="Payment date" required>
            <input type="date" className="field" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
        </div>
        <Field
          label={needsRemark ? "What happened to the first payment?" : "Note"}
          required={needsRemark}
          hint={needsRemark ? "The employee sees this — they said the money never arrived." : undefined}
        >
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-success" onClick={go} disabled={busy || (needsRemark && !note.trim())}>
            <Banknote size={16} /> Mark paid
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AdvanceModal({
  requestId, mode, action, currency, requested, approved, limit, onClose, onDone,
}: {
  requestId: string;
  mode: "approve" | "settle" | "reject";
  /** The exact API action the server said this person may take. */
  action: string;
  currency: string;
  requested: number;
  approved: number;
  limit: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(approved || requested);
  const [settled, setSettled] = useState(approved || requested);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.advanceAction(requestId, {
        action: mode === "reject" ? "reject" : action,
        amount,
        settledAmount: settled,
        remarks,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const title = mode === "settle" ? "Record advance settlement" : mode === "reject" ? "Reject advance" : "Approve advance";
  return (
    <Modal title={`${title} — ${requestId}`} onClose={onClose}>
      <div className="space-y-4">
        {mode === "approve" && (
          <>
            <Field label={`Approved amount (${currency})`} required>
              <input type="number" className="field" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </Field>
            {requested > limit && action !== "dept_head_approve" && (
              <Notice tone="warn" items={[`Above ${currency} ${limit}, this still needs Department Head approval after yours.`]} />
            )}
          </>
        )}
        {mode === "settle" && (
          <Field label={`Settled amount (${currency})`} required hint="What the employee actually returned or adjusted.">
            <input type="number" className="field" value={settled} onChange={(e) => setSettled(Number(e.target.value))} />
          </Field>
        )}
        <Field label="Remarks" required={mode === "reject"}>
          <textarea className="field min-h-20" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={mode === "reject" ? "btn-danger" : "btn-success"} onClick={go} disabled={busy}>
            Confirm
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Rebuilds an editable draft from a stored request, for "Edit & resubmit". */
function toDraft(r: Detail["request"]): RequestDraft {
  return {
    requestId: r.requestId,
    scope: r.scope,
    city: r.city,
    claimType: r.claimType,
    travelType: r.travelType,
    teamMembers: r.teamMembers,
    fromDate: r.fromDate,
    toDate: r.toDate,
    purpose: r.purpose,
    destinationType: r.destinationType,
    tripDirection: r.tripDirection,
    route: r.route,
    dhakaOffice: r.dhakaOffice,
    exceptionClaimed: r.exceptionClaimed,
    exceptionReason: r.exceptionReason,
    advanceWanted: r.advanceWanted,
    payoutMethod: r.payoutMethod,
    bankName: r.bankName,
    bankAccountName: r.bankAccountName,
    bankAccountNumber: r.bankAccountNumber,
    bankRoutingNumber: r.bankRoutingNumber,
    bankBranch: r.bankBranch,
    destination: r.destination,
    startTime: r.startTime,
    endTime: r.endTime,
    workedAt: r.workedAt,
    arrangement: r.arrangement,
    transportMode: r.transportMode,
    vehicleType: r.vehicleType,
    carSpecialApproval: r.carSpecialApproval,
    travelFrom: r.travelFrom,
    travelTo: r.travelTo,
    totalKM: r.totalKM,
    legs: r.legs,
    officeMealTaken: r.officeMealTaken,
    dualWorkstation: r.dualWorkstation,
    dualWorkstationType: r.dualWorkstationType,
    accommodationType: r.accommodationType,
    hotelName: r.hotelName,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    accommodationAmount: r.accommodationAmount,
    rentACarAmount: r.rentACarAmount,
    rentACarHeadcount: r.rentACarHeadcount,
    flightAmount: r.flightAmount,
    otherAmount: r.otherAmount,
    otherNote: r.otherNote,
    advanceType: r.advanceType,
    advanceRequested: r.advanceRequested,
    bkashNumber: r.bkashNumber,
    documentTypes: r.documentTypes,
    documentLinks: r.documentLinks,
    employeeNote: r.employeeNote,
  };
}
