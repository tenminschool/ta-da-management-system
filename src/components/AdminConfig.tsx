import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, GripVertical, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { api, type EmployeeLite } from "../api.js";
import type { InsideCityBlockEntry, UnlockRequest } from "../../shared/types.js";
import { sendMails } from "../lib/mail.js";
import { Card, Notice, Spinner } from "./ui.js";

/**
 * 10MS branches — the offices a "10MS Office" trip can go to. They are the
 * `OtherOffice` rows of the Lists tab; this card adds and removes them without
 * digging through the whole list.
 */
function BranchManager({
  rows, cols, onSaved,
}: { rows: Record<string, string>[]; cols: string[]; onSaved: (rows: Record<string, string>[]) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const branches = rows.filter((r) => r.list_name === "OtherOffice");
  // The branch being renamed, and the name typed so far.
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [editName, setEditName] = useState("");

  // The claim form lists branches in this order, so moving one here moves it there. Branches are
  // rows of the Lists tab among other lists, so the new order is written back into the same slots.
  const [dragging, setDragging] = useState<Record<string, string> | null>(null);
  async function move(from: Record<string, string>, to: Record<string, string>) {
    if (from === to) return;
    const order = branches.filter((b) => b !== from);
    order.splice(order.indexOf(to) + (branches.indexOf(from) < branches.indexOf(to) ? 1 : 0), 0, from);
    let i = 0;
    await persist(rows.map((r) => (r.list_name === "OtherOffice" ? order[i++] : r)));
  }

  async function rename() {
    if (!editing) return;
    const value = editName.trim().replace(/\s+/g, " ");
    if (!value) { setError("The branch needs a name."); return; }
    if (branches.some((b) => b !== editing && b.value.trim().toLowerCase() === value.toLowerCase())) {
      setError("Another branch already has that name.");
      return;
    }
    // Both value and label follow the new name, the same as when a branch is added.
    if (await persist(rows.map((r) => (r === editing ? { ...r, value, label: value } : r)))) setEditing(null);
  }

  async function persist(next: Record<string, string>[]) {
    setBusy(true);
    setError("");
    try {
      await api.saveTab("Lists", next.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))));
      onSaved(next);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const value = name.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (branches.some((b) => b.value.trim().toLowerCase() === value.toLowerCase())) {
      setError("That branch is already in the list.");
      return;
    }
    const row = { list_name: "OtherOffice", value, label: value, extra_1: "", extra_2: "", active: "Yes" };
    if (await persist([...rows, row])) setName("");
  }

  return (
    <Card title="Branches" subtitle="10MS offices people can pick for a “10MS Office” trip. New branches show up in the claim form straight away.">
      {error && <div className="mb-3"><Notice tone="error" items={[error]} /></div>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="field"
          placeholder="New branch name, e.g. Bashundhara LC"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
        />
        <button className="btn-primary shrink-0" onClick={() => void add()} disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add branch
        </button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {branches.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">No branches yet.</li>}
        {branches.map((b) => (
          <li
            key={b.value}
            draggable={editing !== b && !busy}
            onDragStart={() => setDragging(b)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => { if (dragging) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragging) void move(dragging, b); setDragging(null); }}
            className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${dragging === b ? "opacity-40" : ""}`}
          >
            <GripVertical size={16} className="-ml-1 shrink-0 cursor-grab text-slate-300" aria-hidden />
            {editing === b ? (
              <>
                <input
                  className="field min-w-0 flex-1"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setEditing(null); }}
                />
                <div className="flex shrink-0 gap-1">
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                    aria-label="Save name"
                    disabled={busy}
                    onClick={() => void rename()}
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
                  </button>
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                    aria-label="Cancel"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={`min-w-0 flex-1 ${b.active === "No" ? "text-slate-400 line-through" : "text-slate-800"}`}>{b.label || b.value}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    aria-label={`Move ${b.value} up`}
                    disabled={busy || branches.indexOf(b) === 0}
                    onClick={() => void move(b, branches[branches.indexOf(b) - 1])}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    aria-label={`Move ${b.value} down`}
                    disabled={busy || branches.indexOf(b) === branches.length - 1}
                    onClick={() => void move(b, branches[branches.indexOf(b) + 1])}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Rename ${b.value}`}
                    disabled={busy}
                    onClick={() => { setError(""); setEditing(b); setEditName(b.label || b.value); }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Remove ${b.value}`}
                    disabled={busy}
                    onClick={() => void persist(rows.filter((r) => r !== b))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Who gets the mail when a claim reaches HR or Finance: addresses typed here (HR_MAIL_TO,
 * FINANCE_MAIL_TO in the Config tab). Blank falls back to the 10MS groups. Mail only: roles and
 * permissions still come from 10MS.
 */
function DeskMailRecipients({
  rows, cols, onSaved,
}: { rows: Record<string, string>[]; cols: string[]; onSaved: (rows: Record<string, string>[]) => void }) {
  const KEYS = [
    { key: "HR_MAIL_TO", label: "HR desk", hint: "Gets the mail after the supervisor approves, and when someone asks to unlock an older date." },
    { key: "FINANCE_MAIL_TO", label: "Finance desk", hint: "Gets the mail after HR approves, when a claim is ready for payment." },
  ];
  const current = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const [values, setValues] = useState<Record<string, string>>({
    HR_MAIL_TO: current("HR_MAIL_TO"), FINANCE_MAIL_TO: current("FINANCE_MAIL_TO"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    const bad = KEYS.flatMap(({ key, label }) =>
      values[key].split(/[\s,;]+/).filter(Boolean).filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).map((e) => `${label}: "${e}" is not an email address`));
    if (bad.length) { setError(bad.join(". ")); return; }
    setBusy(true);
    setError("");
    setSaved(false);
    let updated = rows;
    for (const { key } of KEYS) {
      const value = values[key].split(/[\s,;]+/).filter(Boolean).join(", ");
      const row = updated.find((r) => r.key === key);
      updated = row
        ? updated.map((r) => (r === row ? { ...r, value } : r))
        : [...updated, { key, value, description: "Mail recipients (comma-separated). Blank = everyone in the matching 10MS group.", effective_from: new Date().toISOString().slice(0, 10) }];
    }
    try {
      await api.saveTab("Config", updated.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))));
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Who gets the HR and Finance emails"
      subtitle="Type the email addresses that should be mailed at each desk, separated by commas. Leave one blank to mail everyone in that 10MS group instead. This is only about email — roles and permissions still come from 10MS."
    >
      {error && <div className="mb-3"><Notice tone="error" items={[error]} /></div>}
      {saved && <div className="mb-3"><Notice tone="info" items={["Saved — new mails use these addresses."]} /></div>}
      <div className="space-y-4">
        {KEYS.map(({ key, label, hint }) => (
          <label key={key} className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
            <textarea
              className="field !h-auto min-h-20"
              rows={2}
              placeholder="name@10minuteschool.com, other@10minuteschool.com"
              value={values[key]}
              onChange={(e) => { setValues((v) => ({ ...v, [key]: e.target.value })); setSaved(false); }}
            />
            <span className="mt-1 block text-xs text-slate-500">{hint}</span>
          </label>
        ))}
      </div>
      <div className="mt-4">
        <button className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </div>
    </Card>
  );
}

const SETTLE_KEY = "SETTLE_BEFORE_NEW_CLAIM";

/**
 * The SETTLE_BEFORE_NEW_CLAIM switch in the Config tab: whether a paid claim has to be confirmed
 * received before the same person can submit another. A missing row counts as Yes.
 */
function SettleRule({
  rows, cols, onSaved,
}: { rows: Record<string, string>[]; cols: string[]; onSaved: (rows: Record<string, string>[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const row = rows.find((r) => r.key === SETTLE_KEY);
  const on = String(row?.value ?? "Yes").trim().toLowerCase() !== "no";

  async function set(next: boolean) {
    if (next === on) return;
    setBusy(true);
    setError("");
    const value = next ? "Yes" : "No";
    const updated = row
      ? rows.map((r) => (r === row ? { ...r, value } : r))
      : [...rows, {
          key: SETTLE_KEY, value,
          description: "Yes: a new claim can't be submitted until the last paid one is confirmed received. No: claims can be submitted any time.",
          effective_from: new Date().toISOString().slice(0, 10),
        }];
    try {
      await api.saveTab("Config", updated.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))));
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Settle before a new claim"
      subtitle="Yes: after a claim is paid, the person has to confirm they received it before they can submit another one. No: they can submit new claims any time."
    >
      {error && <div className="mb-3"><Notice tone="error" items={[error]} /></div>}
      <div className="flex items-center gap-2" role="radiogroup" aria-label="Settle before a new claim">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={on === v}
            disabled={busy}
            onClick={() => void set(v)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              on === v ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
        {busy && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>
    </Card>
  );
}

/** POLICY_BOOK_URL in the Config tab: the Google Drive link of the Policy Book PDF everyone can read. */
function PolicyBookLink({
  rows, cols, onSaved,
}: { rows: Record<string, string>[]; cols: string[]; onSaved: (rows: Record<string, string>[]) => void }) {
  const KEY = "POLICY_BOOK_URL";
  const current = rows.find((r) => r.key === KEY)?.value ?? "";
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    const link = value.trim();
    if (link && !/^https:\/\/(drive|docs)\.google\.com\//.test(link)) {
      setError("Paste a Google Drive link (https://drive.google.com/file/d/…).");
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    const row = rows.find((r) => r.key === KEY);
    const updated = row
      ? rows.map((r) => (r === row ? { ...r, value: link } : r))
      : [...rows, { key: KEY, value: link, description: "Google Drive link of the Policy Book PDF.", effective_from: new Date().toISOString().slice(0, 10) }];
    try {
      await api.saveTab("Config", updated.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))));
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Policy Book"
      subtitle="Paste the Google Drive link of the PDF. Share it as “Anyone with the link can view”. Everyone sees it under Policy Book in the sidebar, as pages they can turn — no download."
    >
      {error && <div className="mb-3"><Notice tone="error" items={[error]} /></div>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field min-w-0 flex-1"
          placeholder="https://drive.google.com/file/d/…/view"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        />
        <button className="btn-primary" disabled={busy || value.trim() === current} onClick={() => void save()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

const DESCRIPTIONS: Record<string, string> = {
  Config: "Rates, limits and thresholds. Change a value here and every calculation follows it immediately.",
  BandPolicy: "Per-band transport lists (male / female), outside-city weekday & weekend rates, accommodation limit, flight and car-pool eligibility.",
  Lists: "Every dropdown in one place, keyed by ListName — City (Extra1 = Inside/Outside), TransportMode (Extra1 = scope, Extra2 = needs receipt), WorkedAt, DualWorkstation, PaymentMethod, DocumentType, and ApprovalStage (Extra1 = step order, Extra2 = role).",
};

export default function AdminConfig({ canEditPolicy = true }: { canEditPolicy?: boolean }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [headers, setHeaders] = useState<Record<string, string[]>>({});
  const [data, setData] = useState<Record<string, Record<string, string>[]>>({});
  const [active, setActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Only administrators read or change the policy tables; everyone else skips the call.
    if (!canEditPolicy) {
      setLoading(false);
      return;
    }
    api.adminTabs()
      .then((r) => {
        setTabs(r.tabs);
        setHeaders(r.headers);
        setData(r.data);
        setActive(r.tabs[0]);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [canEditPolicy]);

  const cols = useMemo(() => (active ? headers[active] || [] : []), [active, headers]);
  const rows = active ? data[active] || [] : [];

  function edit(rowIdx: number, col: string, value: string) {
    setData((d) => ({
      ...d,
      [active]: (d[active] || []).map((r, i) => (i === rowIdx ? { ...r, [col]: value } : r)),
    }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      // `_row` is bookkeeping from the read layer and is not a real column.
      const clean = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""])));
      await api.saveTab(active, clean);
      setMessage(`${active} saved — the new policy is live.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (canEditPolicy && error && !tabs.length) return <Notice tone="error" items={[error]} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
          {canEditPolicy ? "Admin configuration" : "Unlocks & Blocks"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {canEditPolicy
            ? "Every policy value lives here, in the database — changing a rate, a band rule or the approval chain never needs a code change."
            : "Handle late-claim unlock requests and inside-city restrictions."}
        </p>
      </div>

      <UnlockRequestsQueue />
      <ClaimUnlock />
      <InsideCityBlockManager />
      {canEditPolicy && headers.Config && (
        <SettleRule
          rows={data.Config || []}
          cols={headers.Config}
          onSaved={(next) => setData((d) => ({ ...d, Config: next }))}
        />
      )}
      {canEditPolicy && headers.Config && (
        <PolicyBookLink
          rows={data.Config || []}
          cols={headers.Config}
          onSaved={(next) => setData((d) => ({ ...d, Config: next }))}
        />
      )}
      {canEditPolicy && headers.Config && (
        <DeskMailRecipients
          rows={data.Config || []}
          cols={headers.Config}
          onSaved={(next) => setData((d) => ({ ...d, Config: next }))}
        />
      )}
      {canEditPolicy && headers.Lists && (
        <BranchManager
          rows={data.Lists || []}
          cols={headers.Lists}
          onSaved={(next) => setData((d) => ({ ...d, Lists: next }))}
        />
      )}

      {canEditPolicy && (
      <>
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => { setActive(t); setMessage(""); setError(""); }}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              active === t ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <Card
        title={active}
        subtitle={DESCRIPTIONS[active]}
        actions={
          <div className="flex gap-2">
            <button
              className="btn-ghost !px-3 !py-1.5 text-xs"
              onClick={() =>
                setData((d) => ({
                  ...d,
                  [active]: [...(d[active] || []), Object.fromEntries(cols.map((c) => [c, ""]))],
                }))
              }
            >
              <Plus size={14} /> Add row
            </button>
            <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
        }
      >
        {message && <div className="mb-4"><Notice tone="info" items={[message]} /></div>}
        {error && <div className="mb-4"><Notice tone="error" items={[error]} /></div>}

        {/* Phones: a card per row with labelled fields. A 13-column table on a
            360px screen is unusable, however much you let it scroll. */}
        <div className="space-y-3 md:hidden">
          {rows.map((row, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-slate-700">
                  {row[cols[0]] || `Row ${i + 1}`}
                </span>
                <button
                  onClick={() => setData((d) => ({ ...d, [active]: (d[active] || []).filter((_, idx) => idx !== i) }))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 active:bg-rose-50 active:text-rose-600"
                  aria-label="Delete row"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="space-y-2">
                {cols.map((c) => (
                  <label key={c} className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{c}</span>
                    <input
                      className="field"
                      value={row[c] ?? ""}
                      onChange={(e) => edit(i, c, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="-mx-1 hidden max-h-[65vh] overflow-auto px-1 md:block">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-2 font-semibold">{c}</th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className="px-1 py-1">
                      <input
                        className="field !px-2 !py-1.5 !text-xs"
                        // Wide enough for the column's longest value (capped), so a list like
                        // "Rickshaw,CNG,Car,Metro Rail" is not cut off; hover shows it in full.
                        style={{ minWidth: `${Math.min(36, Math.max(6, ...rows.map((r) => (r[c] ?? "").length)) + 3)}ch` }}
                        title={row[c] ?? ""}
                        value={row[c] ?? ""}
                        onChange={(e) => edit(i, c, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      onClick={() => setData((d) => ({ ...d, [active]: (d[active] || []).filter((_, idx) => idx !== i) }))}
                      className="flex size-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Delete row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!rows.length && <p className="py-8 text-center text-sm text-slate-400">No rows. Add one to get started.</p>}
      </Card>
      </>
      )}
    </div>
  );
}

/**
 * Lets one person file a claim the window has already closed on.
 *
 * Granted against the employee, not a claim: the claim they need to file does
 * not exist yet — the window is what is stopping them creating it.
 */
/** "Contact HR" requests raised from the New Request form, waiting on a decision. */
function UnlockRequestsQueue() {
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.unlockRequests("pending")
      .then((r) => setRequests(r.requests))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;
  // Nothing pending is the common case — no point taking up space for it.
  if (!requests.length && !error) return null;

  return (
    <Card
      title="Unlock requests"
      subtitle="Raised from the claim form's “Contact HR” button — approving one unlocks just that trip, not an open window like the tool below."
    >
      {error && <Notice tone="error" items={[error]} />}
      <div className="space-y-3">
        {requests.map((r) => (
          <UnlockRequestRow key={r.requestId} request={r} onDone={load} />
        ))}
      </div>
    </Card>
  );
}

function UnlockRequestRow({ request, onDone }: { request: UnlockRequest; onDone: () => void }) {
  const [unlockFrom, setUnlockFrom] = useState(request.requestedFrom);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    if (!remarks.trim()) {
      setError("Add a remark explaining your decision.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.decideUnlock(request.requestId, action, remarks.trim(), action === "approve" ? unlockFrom : undefined);
      await sendMails(res.mail);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <p className="text-sm font-semibold text-slate-800">
        {request.employeeName} <span className="font-normal text-slate-400">{request.employeeId} · {request.department}</span>
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Asked for {request.requestedFrom || "—"} · submitted {new Date(request.submittedAt).toLocaleString()}
      </p>
      <p className="mt-2 text-sm text-slate-700">{request.reason}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div>
          <label className="label">Unlock exactly this date</label>
          <input type="date" className="field" value={unlockFrom} onChange={(e) => setUnlockFrom(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-400">Only this one trip — not an open window for anything filed after it.</p>
        </div>
        <div>
          <label className="label">Remarks</label>
          <input
            className="field"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Why you're approving or declining this."
          />
        </div>
      </div>
      {error && <div className="mt-2"><Notice tone="error" items={[error]} /></div>}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-danger" disabled={busy} onClick={() => decide("reject")}>Reject</button>
        <button className="btn-primary" disabled={busy || !unlockFrom} onClick={() => decide("approve")}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Approve & unlock
        </button>
      </div>
    </div>
  );
}

function ClaimUnlock() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<EmployeeLite[]>([]);
  const [picked, setPicked] = useState<EmployeeLite | null>(null);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q.trim() || picked) { setFound([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { employees } = await api.employees(q.trim());
        if (!cancelled) setFound(employees.slice(0, 6));
      } catch { /* the list is a convenience; typing an ID still works */ }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q, picked]);

  async function save(date: string) {
    if (!picked) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api.claimUnlock(picked.employeeId, date);
      setMessage(
        date
          ? `${picked.name} can file claims for travel from ${date} onward.`
          : `Late claims closed again for ${picked.name}.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Unlock a late claim"
      subtitle="Claims must be filed within the window set by CLAIM_WINDOW_DAYS. Pick the earliest travel date one person may now file for."
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="relative">
          <label className="label">Employee</label>
          {picked ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium text-slate-800">{picked.name}</span>{" "}
                <span className="text-slate-400">{picked.employeeId}</span>
              </span>
              <button
                onClick={() => { setPicked(null); setQ(""); setMessage(""); }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Choose someone else"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <input
              className="field"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or employee ID"
            />
          )}
          {!picked && found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-md">
              {found.map((e) => (
                <li key={e.employeeId}>
                  <button
                    onClick={() => { setPicked(e); setFound([]); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-800">{e.name}</span>{" "}
                    <span className="text-xs text-slate-400">{e.employeeId} · {e.department}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="label">Unlocked from</label>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={!picked || busy || !from} onClick={() => save(from)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Unlock
          </button>
          <button className="btn-ghost" disabled={!picked || busy} onClick={() => save("")}>
            Lock
          </button>
        </div>
      </div>

      {message && <div className="mt-4"><Notice tone="info" items={[message]} /></div>}
      {error && <div className="mt-4"><Notice tone="error" items={[error]} /></div>}
    </Card>
  );
}

function InsideCityBlockManager() {
  const [entries, setEntries] = useState<InsideCityBlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [editing, setEditing] = useState<string>(""); // original email being edited, if any
  const [editEmail, setEditEmail] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busyEmail, setBusyEmail] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    api.insideCityBlock()
      .then((r) => setEntries(r.entries))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function add() {
    setAdding(true);
    setAddError("");
    try {
      await api.addInsideCityBlock(newEmail.trim(), newNote.trim());
      setNewEmail("");
      setNewNote("");
      load();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(e: InsideCityBlockEntry) {
    setEditing(e.email);
    setEditEmail(e.email);
    setEditNote(e.note);
  }

  async function saveEdit(originalEmail: string) {
    setBusyEmail(originalEmail);
    setRowError((r) => ({ ...r, [originalEmail]: "" }));
    try {
      await api.updateInsideCityBlock(originalEmail, editEmail.trim(), editNote.trim());
      setEditing("");
      load();
    } catch (err) {
      setRowError((r) => ({ ...r, [originalEmail]: (err as Error).message }));
    } finally {
      setBusyEmail("");
    }
  }

  async function remove(email: string) {
    setBusyEmail(email);
    setRowError((r) => ({ ...r, [email]: "" }));
    try {
      await api.removeInsideCityBlock(email);
      load();
    } catch (err) {
      setRowError((r) => ({ ...r, [email]: (err as Error).message }));
    } finally {
      setBusyEmail("");
    }
  }

  return (
    <Card
      title="Inside-city restrictions"
      subtitle="Someone here can still see every claim as usual and still raise an outside-city one — just not a new inside-city request."
    >
      {loading ? <Spinner /> : (
        <>
          {entries.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-100 text-sm">
              {entries.map((e) => (
                <li key={e.email} className="py-2.5">
                  {editing === e.email ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input className="field" value={editEmail} onChange={(ev) => setEditEmail(ev.target.value)} />
                      <input className="field" placeholder="Note (optional)" value={editNote} onChange={(ev) => setEditNote(ev.target.value)} />
                      <div className="flex gap-2">
                        <button
                          className="btn-primary shrink-0"
                          disabled={busyEmail === e.email || !editEmail.trim()}
                          onClick={() => saveEdit(e.email)}
                        >
                          {busyEmail === e.email ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                        <button className="btn-ghost shrink-0" onClick={() => setEditing("")}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800">{e.email}</span>
                        {e.note && <span className="ml-2 text-xs text-slate-500">{e.note}</span>}
                        <span className="ml-2 block text-xs text-slate-400 sm:inline">Added by {e.addedBy.replace(/<.*>/, "").trim()}</span>
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          onClick={() => startEdit(e)}
                          aria-label={`Edit ${e.email}`}
                        >
                          <Save size={14} />
                        </button>
                        <button
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          disabled={busyEmail === e.email}
                          onClick={() => remove(e.email)}
                          aria-label={`Remove ${e.email}`}
                        >
                          {busyEmail === e.email ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </div>
                  )}
                  {rowError[e.email] && <p className="mt-1 text-xs text-rose-600">{rowError[e.email]}</p>}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <input
              className="field"
              type="email"
              placeholder="name@10minuteschool.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <input className="field" placeholder="Note (optional)" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
            <button className="btn-primary shrink-0" disabled={adding || !newEmail.trim()} onClick={add}>
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Restrict
            </button>
          </div>
          {addError && <div className="mt-3"><Notice tone="error" items={[addError]} /></div>}
          {error && <div className="mt-3"><Notice tone="error" items={[error]} /></div>}
        </>
      )}
    </Card>
  );
}
