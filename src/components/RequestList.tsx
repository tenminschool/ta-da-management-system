import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, FileSpreadsheet, RotateCcw, UploadCloud, X } from "lucide-react";
import { api, type RequestListItem } from "../api.js";
import { STATUS_GROUPS, STATUS_LABEL, type StatusGroup } from "../../shared/types.js";
import { downloadCSV } from "../lib/csv.js";
import { Card, Empty, Money, Notice, ProgressBar, SearchInput, Spinner, StatusBadge } from "./ui.js";
import PaymentReconcileModal from "./PaymentReconcile.js";

export default function RequestList({
  scope, title, subtitle, onOpen, refreshKey, showEmployee = true, showFilters = false,
  group, onClearGroup, quickFilters, selectable = false,
}: {
  scope: string;
  title: string;
  subtitle: string;
  onOpen: (id: string) => void;
  refreshKey?: number;
  /** Hidden on personal lists, where every row is the same person. */
  showEmployee?: boolean;
  /** The full filter bar — for the oversight register, not personal lists. */
  showFilters?: boolean;
  /** Opened from a dashboard card: show only that card's claims. */
  group?: StatusGroup;
  onClearGroup?: () => void;
  /** One-tap filters above the list, e.g. Finance's own queue. */
  quickFilters?: { key: string; label: string; statuses: string[] }[];
  /** Tick claims off and export them — Finance building a payment file. */
  selectable?: boolean;
}) {
  const [rows, setRows] = useState<RequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [travelScope, setTravelScope] = useState("");
  const [waiting, setWaiting] = useState("");
  const [quick, setQuick] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: "warn" | "error"; text: string } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.requests(scope)
      .then((r) => setRows(r.requests))
      .finally(() => setLoading(false));
  }, [scope, refreshKey, reload]);

  // Filter options come from the data itself, so a new department in the sheet
  // shows up here without any code change.
  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(),
    [rows],
  );
  const waitingOptions = useMemo(
    () => [...new Set(rows.map((r) => r.waitingOn).filter(Boolean))].sort(),
    [rows],
  );

  const groupStatuses = group ? (STATUS_GROUPS[group].statuses as readonly string[]) : null;
  const quickStatuses = quick ? quickFilters?.find((f) => f.key === quick)?.statuses ?? null : null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupStatuses && !groupStatuses.includes(r.status)) return false;
      if (quickStatuses && !quickStatuses.includes(r.status)) return false;
      if (status && r.status !== status) return false;
      if (department && r.department !== department) return false;
      if (travelScope && r.scope !== travelScope) return false;
      if (waiting && r.waitingOn !== waiting) return false;
      if (!needle) return true;
      return [r.requestId, r.employeeName, r.employeeId, r.email, r.city, r.destination, r.purpose, r.department]
        .some((v) => String(v || "").toLowerCase().includes(needle));
    });
  }, [rows, q, status, department, travelScope, waiting, groupStatuses, quickStatuses]);

  const activeFilters = [status, department, travelScope, waiting, quick, q.trim()].filter(Boolean).length;
  const pickedRows = filtered.filter((r) => picked.has(r.requestId));
  const allPicked = !!filtered.length && pickedRows.length === filtered.length;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const totalValue = filtered.reduce((s, r) => s + r.finalPayable, 0);

  /** The bKash bulk-disbursement file, built from whichever rows are ticked. */
  async function exportPaymentFile() {
    setExporting(true);
    setExportNotice(null);
    try {
      const { blob, filename, skipped } = await api.paymentExport([...picked]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (skipped.length) {
        setExportNotice({
          tone: "warn",
          text: `${skipped.length} of ${picked.size} claim(s) were left out of the file — no bKash number to pay: ${skipped.join(", ")}.`,
        });
      }
    } catch (err) {
      setExportNotice({ tone: "error", text: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  function reset() {
    setQuick("");
    setPicked(new Set());
    setExportNotice(null);
    setQ("");
    setStatus("");
    setDepartment("");
    setTravelScope("");
    setWaiting("");
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <Card>
        <div className="mb-4 space-y-2">
          {group && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              {STATUS_GROUPS[group].label} only
              {onClearGroup && (
                <button onClick={onClearGroup} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="Show all claims">
                  <X size={12} />
                </button>
              )}
            </span>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <SearchInput
              className="flex-1"
              value={q}
              onChange={setQ}
              placeholder={showFilters ? "Name, employee ID, request ID, city or purpose" : "Search ID, city or purpose"}
            />
            <select className="field sm:w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {showFilters && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <select className="field sm:flex-1" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select className="field sm:flex-1" value={waiting} onChange={(e) => setWaiting(e.target.value)}>
                <option value="">Any stage</option>
                {waitingOptions.map((w) => (
                  <option key={w} value={w}>Waiting on: {w}</option>
                ))}
              </select>
              <select className="field sm:w-44" value={travelScope} onChange={(e) => setTravelScope(e.target.value)}>
                <option value="">Inside & outside</option>
                <option value="inside">Inside city</option>
                <option value="outside">Outside city</option>
              </select>
            </div>
          )}

          {quickFilters?.length && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[{ key: "", label: "All" }, ...quickFilters].map((f) => (
                <button
                  key={f.key}
                  // Changing what is on screen clears the selection: exporting
                  // a row you can no longer see would be a nasty surprise.
                  onClick={() => { setQuick(f.key); setPicked(new Set()); }}
                  className={`flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-semibold transition ${
                    quick === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {f.key
                      ? rows.filter((r) => quickFilters.find((x) => x.key === f.key)!.statuses.includes(r.status)).length
                      : rows.length}
                  </span>
                </button>
              ))}
            </div>
          ) || null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>
              <span className="font-semibold text-slate-700">{filtered.length}</span> of {rows.length} claim(s)
            </span>
            <span>·</span>
            <span>
              Total payable <span className="font-semibold text-slate-700"><Money value={totalValue} /></span>
            </span>
            {activeFilters > 0 && (
              <button onClick={reset} className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                <RotateCcw size={12} /> Clear filters
              </button>
            )}
          </div>
        </div>

        {selectable && !!filtered.length && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <label className="-my-1 flex min-h-11 cursor-pointer items-center gap-2 py-1 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="size-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 sm:size-4"
                checked={allPicked}
                ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !allPicked; }}
                onChange={(e) => setPicked(e.target.checked ? new Set(filtered.map((r) => r.requestId)) : new Set())}
              />
              Select all
            </label>
            <span className="text-xs text-slate-500">
              {picked.size ? `${picked.size} selected · ` : ""}
              <Money value={pickedRows.reduce((sum, r) => sum + r.finalPayable, 0)} /> payable
            </span>
            <div className="ml-auto flex gap-2">
              <button
                className="btn-ghost !px-3 !py-1.5 text-xs"
                disabled={!picked.size}
                onClick={() => downloadCSV(`claims-${new Date().toISOString().slice(0, 10)}.csv`, pickedRows)}
              >
                <Download size={14} /> Download CSV
              </button>
              <button
                className="btn-primary !px-3 !py-1.5 text-xs"
                disabled={!picked.size || exporting}
                onClick={exportPaymentFile}
                title="The bKash bulk-disbursement workbook — Wallet No and Principal Amount filled in, everything else left as it is."
              >
                <FileSpreadsheet size={14} /> {exporting ? "Building…" : "Download payment file"}
              </button>
              <button
                className="btn-success !px-3 !py-1.5 text-xs"
                onClick={() => setReconciling(true)}
                title="Upload the bKash/eMoney settlement export from a payout run — matching claims are marked paid after you review them."
              >
                <UploadCloud size={14} /> Reconcile from file
              </button>
            </div>
          </div>
        )}

        {exportNotice && <Notice tone={exportNotice.tone} items={[exportNotice.text]} />}

        {loading ? (
          <Spinner />
        ) : !filtered.length ? (
          <Empty
            title={rows.length ? "Nothing matches these filters" : "Nothing here yet"}
            hint={rows.length ? "Try clearing a filter." : "Requests will appear as they are created."}
          />
        ) : (
          <>
            {/* Phones: one tappable card per claim — tables don't fit a phone. */}
            <ul className="space-y-2 md:hidden">
              {filtered.map((r) => (
                <li key={r.requestId} className="flex items-start gap-2">
                  {selectable && (
                    <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        className="size-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={picked.has(r.requestId)}
                        onChange={() => toggle(r.requestId)}
                        aria-label={`Select ${r.requestId}`}
                      />
                    </label>
                  )}
                  <button
                    onClick={() => onOpen(r.requestId)}
                    className="w-full min-w-0 rounded-xl border border-slate-200 p-3 text-left transition active:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-700">{r.requestId}</span>
                        {r.isMine && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">YOU</span>}
                        {showEmployee && (
                          <span className="mt-0.5 block truncate text-sm font-medium text-slate-800">
                            {r.employeeName} <span className="text-xs font-normal text-slate-400">{r.employeeId}</span>
                          </span>
                        )}
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {r.department} · {r.scope === "inside" ? "Inside" : "Outside"} · {r.city} · {r.fromDate}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-sm font-bold text-slate-800">
                          <Money value={r.finalPayable} />
                        </span>
                        <ChevronRight size={16} className="text-slate-300" />
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-3">
                      <StatusBadge status={r.status} />
                      <div className="min-w-0 flex-1">
                        <ProgressBar status={r.status} />
                      </div>
                    </div>
                    {r.waitingOn && (
                      <p className="mt-1.5 text-xs text-slate-500">Waiting on: <span className="font-medium text-slate-700">{r.waitingOn}</span></p>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {/* Tablet and up: the full table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {selectable && <th className="w-12 px-1 py-2.5" />}
                    <th className="px-3 py-2.5 font-semibold">Request</th>
                    {showEmployee && <th className="px-3 py-2.5 font-semibold">Employee</th>}
                    <th className="px-3 py-2.5 font-semibold">Travel</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    {showFilters && <th className="px-3 py-2.5 font-semibold">Waiting on</th>}
                    <th className="px-3 py-2.5 font-semibold">Progress</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Payable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr
                      key={r.requestId}
                      onClick={() => onOpen(r.requestId)}
                      className="cursor-pointer transition hover:bg-slate-50"
                    >
                      {selectable && (
                        <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                          <label className="flex size-10 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              checked={picked.has(r.requestId)}
                              onChange={() => toggle(r.requestId)}
                              aria-label={`Select ${r.requestId}`}
                            />
                          </label>
                        </td>
                      )}
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs font-semibold text-slate-700">{r.requestId}</span>
                        {r.isMine && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">YOU</span>}
                        <span className="mt-0.5 block text-xs text-slate-400">{r.fromDate}</span>
                      </td>
                      {showEmployee && (
                        <td className="px-3 py-3">
                          <span className="font-medium text-slate-800">{r.employeeName}</span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {r.employeeId} · Band {r.band} · {r.department}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-3 text-slate-600">
                        {r.scope === "inside" ? "Inside city" : "Outside city"}
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {r.city}{r.destination ? ` · ${r.destination}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                      {showFilters && (
                        <td className="px-3 py-3 text-slate-600">
                          {r.waitingOn || "—"}
                          {r.lastAction && (
                            <span className="mt-0.5 block text-xs text-slate-400">{r.lastAction}</span>
                          )}
                        </td>
                      )}
                      <td className="w-40 px-3 py-3"><ProgressBar status={r.status} /></td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-800">
                        <Money value={r.finalPayable} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {reconciling && (
        <PaymentReconcileModal
          onClose={() => setReconciling(false)}
          onDone={() => { setPicked(new Set()); setReload((n) => n + 1); }}
        />
      )}
    </div>
  );
}
