import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "../api.js";
import type { Policy, VehicleRegistration } from "../../shared/types.js";
import { cfgStr } from "../../shared/policy.js";
import { Card, Empty, Field, Modal, Money, Notice, Spinner } from "./ui.js";

/**
 * HR/Admin's queue of personal vehicles waiting for a rate to be approved.
 *
 * One row per employee — a resubmission after rejection overwrites their row
 * rather than adding another, so there is never more than one open decision
 * per person.
 */
export default function VehicleRegistrations({ policy }: { policy: Policy }) {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<VehicleRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<VehicleRegistration | null>(null);
  const currency = cfgStr(policy, "CURRENCY", "BDT");

  async function load() {
    setLoading(true);
    try {
      setRows((await api.vehicles(tab)).vehicles);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateFor = (v: VehicleRegistration) => {
    const fuel = policy.fuelTypes.find((f) => f.value === v.fuelType);
    return fuel && v.mileageKmPerLitre > 0 ? fuel.pricePerLitre / v.mileageKmPerLitre : 0;
  };

  const STATUS_STYLE: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-rose-50 text-rose-700",
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Vehicle registrations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Approve a vehicle before it can be claimed against — reimbursement is priced from its mileage and the
          current fuel price, not a flat band rate.
        </p>
      </div>

      <div className="flex gap-2">
        {(["pending", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
              tab === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <Notice tone="error" items={[error]} />}

      <Card>
        {!rows.length ? (
          <Empty
            title={tab === "pending" ? "Nothing waiting on you" : "No vehicles registered yet"}
            hint={tab === "pending" ? "New registrations appear here." : "They will appear here once someone registers a personal vehicle."}
          />
        ) : (
          <>
            {/* Phones: a card per registration */}
            <ul className="space-y-2 md:hidden">
              {rows.map((v) => (
                <li key={v.employeeId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">{v.employeeName}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {v.vehicleType} — {v.model} · {v.fuelType}, {v.mileageKmPerLitre} km/l
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[v.status]}`}>
                      {v.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">
                      <Money value={rateFor(v)} currency={currency} />/km
                    </span>
                    {v.status === "pending" && (
                      <div className="flex gap-2">
                        <button className="btn-success !py-1.5 text-xs" onClick={() => setDeciding(v)}>
                          <Check size={13} /> Decide
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Employee</th>
                    <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                    <th className="px-3 py-2.5 font-semibold">Fuel</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Mileage</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Submitted</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((v) => (
                    <tr key={v.employeeId} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <span className="font-medium text-slate-800">{v.employeeName}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{v.employeeId}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{v.vehicleType} — {v.model}</td>
                      <td className="px-3 py-3 text-slate-600">{v.fuelType}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{v.mileageKmPerLitre} km/l</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-800">
                        <Money value={rateFor(v)} currency={currency} />/km
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[v.status]}`}>
                          {v.status}
                        </span>
                        {v.status !== "pending" && v.reviewNote && (
                          <span className="mt-1 block max-w-[16rem] truncate text-xs text-slate-400" title={v.reviewNote}>
                            {v.reviewNote}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {v.submittedAt ? new Date(v.submittedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {v.status === "pending" && (
                          <button className="btn-success !px-2.5 !py-1 text-xs" onClick={() => setDeciding(v)}>
                            <Check size={13} /> Decide
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {deciding && (
        <DecideVehicleModal
          vehicle={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => { setDeciding(null); load(); }}
        />
      )}
    </div>
  );
}

function DecideVehicleModal({
  vehicle, onClose, onDone,
}: { vehicle: VehicleRegistration; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    if (action === "reject" && !remarks.trim()) {
      setError("Add a remark explaining why this vehicle was not approved.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.decideVehicle(vehicle.employeeId, action, remarks.trim());
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${vehicle.employeeName}'s vehicle`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">{vehicle.vehicleType} — {vehicle.model}</p>
          <p className="mt-0.5">{vehicle.fuelType} · {vehicle.mileageKmPerLitre} km per litre</p>
        </div>
        <Field label="Remarks" hint="Required if you are rejecting this — the employee sees it.">
          <textarea className="field min-h-20" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-danger" onClick={() => decide("reject")} disabled={busy}>Reject</button>
          <button className="btn-success" onClick={() => decide("approve")} disabled={busy}>Approve</button>
        </div>
      </div>
    </Modal>
  );
}
