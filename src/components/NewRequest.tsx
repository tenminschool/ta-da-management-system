import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, FileText, FileUp, Loader2, Plus, Send, Trash2, Users,
} from "lucide-react";
import { api } from "../api.js";
import {
  bankPayoutAllowed, cfgNum, cfgStr, computeRequest, eligibleModes, emptyDraft, fuelRateFor,
  impliedLegs, type ModeOption,
} from "../../shared/policy.js";
import type { Leg, Policy, RequestDraft, SessionUser, TeamMember } from "../../shared/types.js";
import { Card, ChoiceGrid, Field, Money, MultiSelect, Notice, SearchInput, Toggle } from "./ui.js";

const STEPS = ["Travel Type", "Transportation", "Allowances", "Documents"];

export default function NewRequest({
  user, policy, editing, onDone, onCancel,
}: {
  user: SessionUser;
  policy: Policy;
  editing?: { draft: RequestDraft; requestId: string } | null;
  onDone: (requestId: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editing?.draft) return editing.draft;
    // Pre-fill the payout number from the Employees sheet so most people only
    // have to confirm it.
    const start = emptyDraft("inside");
    return { ...start, bkashNumber: user.accountNumber || "" };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currency = cfgStr(policy, "CURRENCY", "BDT");
  const set = (patch: Partial<RequestDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const teamSize = draft.travelType === "team" ? draft.teamMembers.length + 1 : 1;
  const computation = useMemo(() => computeRequest(policy, draft, user), [policy, draft, user]);
  const modes = useMemo(
    () => eligibleModes(policy, {
      band: user.band,
      gender: user.gender,
      scope: draft.scope,
      travelType: draft.travelType,
      teamSize,
      teamGenders: draft.teamMembers.map((m) => m.gender),
      carSpecialApproval: draft.carSpecialApproval,
    }),
    [policy, user, draft.scope, draft.travelType, teamSize, draft.teamMembers, draft.carSpecialApproval],
  );

  // The journey the form already knows about, kept in step with it. Fares are
  // carried across so editing a date never wipes what has been typed, and any
  // extra hops added by hand are left alone at the end of the list.
  const implied = useMemo(() => impliedLegs(policy, draft), [
    policy, draft.transportMode, draft.scope, draft.fromDate, draft.toDate,
    draft.city, draft.route, draft.destination, draft.destinationType, draft.tripDirection,
  ]);
  const impliedKey = implied.map((l) => [l.travelDate, l.mode, l.travelFrom, l.travelTo].join("|")).join("\n");
  useEffect(() => {
    setDraft((d) => {
      const kept = d.legs.slice(implied.length);
      const merged = implied.map((l, i) => ({ ...l, amount: d.legs[i]?.amount ?? 0, note: d.legs[i]?.note ?? "" }));
      return { ...d, legs: [...merged, ...kept] };
    });
  }, [impliedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching city scope invalidates a mode that only exists on the other side.
  useEffect(() => {
    if (draft.transportMode && !modes.some((m) => m.mode === draft.transportMode)) {
      set({ transportMode: "" });
    }
  }, [modes]); // eslint-disable-line react-hooks/exhaustive-deps

  const insideCities = policy.cities.filter((c) => c.zone === "Inside");

  async function save(submit: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = editing
        ? await api.update(editing.requestId, draft, submit)
        : await api.create(draft, submit);
      onDone(res.request.requestId);
    } catch (err) {
      setError((err as Error).message);
      setStep(STEPS.length - 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">
            {editing ? `Edit ${editing.requestId}` : "New travel claim"}
          </h1>
          <p className="text-xs text-slate-500">
            The system applies your Band {user.band} policy automatically — you only enter what happened.
          </p>
        </div>
      </div>

      <Stepper step={step} onStep={setStep} />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {step === 0 && (
            <StepTravelType
              draft={draft}
              set={set}
              insideCities={insideCities.map((c) => c.city)}
              user={user}
              policy={policy}
              computation={computation}
            />
          )}
          {step === 1 && (
            <StepTransport
              draft={draft} set={set} policy={policy} modes={modes} user={user}
              currency={currency} impliedCount={implied.length}
            />
          )}
          {step === 2 && (
            <StepAllowances draft={draft} set={set} policy={policy} user={user} computation={computation} currency={currency} />
          )}
          {step === 3 && (
            <StepDocuments
              draft={draft}
              set={set}
              documentTypes={policy.documentTypes}
              payable={computation.finalPayable}
              currency={currency}
              bankAllowed={bankPayoutAllowed(policy)}
              needsReceipt={computation.needsReceipt}
            />
          )}

          {error && <Notice tone="error" items={[error]} />}

          <div className="sticky bottom-[4.25rem] z-10 -mx-3 flex items-center gap-2 border-t border-slate-200 bg-slate-100/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 lg:bottom-0">
            <button
              className="btn-ghost shrink-0 !px-3 sm:!px-4"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft size={16} /> <span className="hidden sm:inline">Back</span>
            </button>
            <div className="flex flex-1 gap-2 sm:flex-none">
              <button className="btn-ghost flex-1 whitespace-nowrap sm:flex-none" onClick={() => save(false)} disabled={busy}>
                Save draft
              </button>
              {step < STEPS.length - 1 ? (
                <button className="btn-primary flex-1 sm:flex-none" onClick={() => setStep((s) => s + 1)}>
                  Next <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  className="btn-primary flex-1 whitespace-nowrap sm:flex-none"
                  onClick={() => save(true)}
                  disabled={busy || computation.errors.length > 0}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit request
                </button>
              )}
            </div>
          </div>
        </div>

        <LiveSummary computation={computation} currency={currency} />
      </div>
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <ol className="card flex gap-0.5 overflow-x-auto p-1.5 sm:gap-1 sm:p-2">
      {STEPS.map((label, i) => (
        <li key={label} className="min-w-0 flex-1">
          <button
            onClick={() => onStep(i)}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition sm:gap-2 sm:px-3 ${
              i === step
                ? "bg-brand-600 text-white"
                : i < step
                  ? "text-emerald-700 hover:bg-emerald-50"
                  : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {i < step ? <Check size={14} /> : <span className="tabular-nums">{i + 1}</span>}
            <span className="hidden sm:inline">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ── Step 1 ──────────────────────────────────────────────────────────────────

function StepTravelType({
  draft, set, insideCities, user, policy, computation,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  insideCities: string[];
  user: SessionUser;
  policy: Policy;
  computation: ReturnType<typeof computeRequest>;
}) {
  // Some destinations only exist in some cities — Other Office is Dhaka-only.
  const destinationOptions = policy.destinationTypes.filter(
    (d) => !d.cities.length || d.cities.includes(draft.city),
  );
  const outside = draft.scope === "outside";
  const route = policy.routes.find((r) => r.value === draft.route);
  const destination = destinationOptions.find((d) => d.value === draft.destinationType);
  const destinationNeeds = destination?.needs;
  const destinationLabel = destination?.label || "";

  // Company Arrangement chosen against one date can go stale if the date is
  // pushed closer — dropped back to Self rather than left selected behind a
  // disabled option nobody notices.
  useEffect(() => {
    if (draft.arrangement === "company" && !computation.noticeOK) set({ arrangement: "self" });
  }, [computation.noticeOK]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Card title="What type of travel are you making?">
        <ChoiceGrid
          value={draft.scope}
          onChange={(scope) =>
            set({
              scope,
              city: scope === "inside" ? insideCities[0] || "" : "",
              // Outside-city asks for a return date; inside-city is a single day.
              toDate: scope === "inside" ? draft.fromDate : "",
              // Route belongs to outside-city, destination to inside-city;
              // neither should survive a switch to the other.
              route: "",
              destinationType: "",
              destination: "",
              purpose: "",
              transportMode: "",
              tripDirection: "one_way",
            })
          }
          options={[
            { value: "inside", label: "Inside City", description: `Same-city travel — ${insideCities.join(", ")}` },
            { value: "outside", label: "Outside City", description: "Travel to another district, with per-diem and accommodation" },
          ]}
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {draft.scope === "outside" ? (
            <>
              <Field label="Route" required>
                <select
                  className="field"
                  value={draft.route}
                  // The city is the route's end, so it is set here — except on
                  // an "Other city" route, where it is what gets typed next.
                  // Destination follows the city; it stays editable for anyone
                  // who wants to name the actual office rather than the city.
                  onChange={(e) => {
                    const picked = policy.routes.find((r) => r.value === e.target.value);
                    set({ route: e.target.value, city: picked?.to || "", destination: picked?.to || "" });
                  }}
                >
                  <option value="">Select a route</option>
                  {policy.routes.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>

              {route && !route.to && (
                <Field label={`${route.from} to`} required>
                  <input
                    className="field"
                    value={draft.city}
                    onChange={(e) => set({ city: e.target.value, destination: e.target.value })}
                    placeholder="Which city?"
                  />
                </Field>
              )}
            </>
          ) : (
          <Field label="City" required>
            <select
              className="field"
              value={draft.city}
              onChange={(e) => {
                const city = e.target.value;
                // Moving to a city where the chosen destination does not exist
                // would otherwise leave it selected but off the list.
                const stillOffered = policy.destinationTypes.some(
                  (d) => d.value === draft.destinationType && (!d.cities.length || d.cities.includes(city)),
                );
                set(stillOffered ? { city } : { city, destinationType: "", destination: "", purpose: "" });
              }}
            >
              <option value="">Select a city</option>
              {insideCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          )}

          {draft.scope === "outside" && (
            <Field label="Travel arrangement" required>
              <select
                className="field"
                value={draft.arrangement}
                onChange={(e) => set({ arrangement: e.target.value as RequestDraft["arrangement"] })}
              >
                <option value="self">Self Arrangement</option>
                <option value="company" disabled={!computation.noticeOK}>
                  Company Arrangement{!computation.noticeOK ? " — needs more notice" : ""}
                </option>
              </select>
            </Field>
          )}

          {draft.scope === "outside" && !computation.noticeOK && (
            <div className="sm:col-span-2">
              <Notice
                tone="warn"
                items={[
                  `Company Arrangement and a travel advance both need at least ${computation.noticeDaysRequired} business ` +
                  `days' notice before travel${draft.fromDate ? ` — this trip is only ${computation.noticeGiven} business day(s) away` : ""}. ` +
                  "Choose Self Arrangement, or contact Administration if this cannot wait.",
                ]}
              />
            </div>
          )}

          {/* Inside-city trips name where they went right here, next to the
              city. Outside-city keeps the free-text pair on Trip details. */}
          {draft.scope === "inside" && draft.city && (
            <>
              <Field label="Destination" required>
                <select
                  className="field"
                  value={draft.destinationType}
                  // Both follow-ups are cleared on a change of mind, so a name
                  // typed for a University cannot survive into an Other Office.
                  onChange={(e) => set({ destinationType: e.target.value, destination: "", purpose: "" })}
                >
                  <option value="">Select a destination</option>
                  {destinationOptions.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </Field>

              {destinationNeeds === "name" && (
                <>
                  <Field label={`${destinationLabel} name`} required>
                    <input
                      className="field"
                      value={draft.destination}
                      onChange={(e) => set({ destination: e.target.value })}
                      placeholder={`Which ${destinationLabel.toLowerCase()}?`}
                    />
                  </Field>
                  <Field label="Purpose" required>
                    <input
                      className="field"
                      value={draft.purpose}
                      onChange={(e) => set({ purpose: e.target.value })}
                      placeholder="Partner meeting, campus activation…"
                    />
                  </Field>
                </>
              )}

              {destinationNeeds === "office" && (
                <Field label="Office name" required>
                  <select className="field" value={draft.purpose} onChange={(e) => set({ purpose: e.target.value })}>
                    <option value="">Select an office</option>
                    {policy.otherOffices.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              )}

              {destinationNeeds === "purpose" && (
                <Field label="Purpose" required>
                  <input
                    className="field"
                    value={draft.purpose}
                    onChange={(e) => set({ purpose: e.target.value })}
                    placeholder="Where you went and why"
                  />
                </Field>
              )}
            </>
          )}

          <Field label={outside ? "Departure date" : "Travel date"} required>
            <input
              type="date"
              className="field"
              value={draft.fromDate}
              onChange={(e) => set({ fromDate: e.target.value, toDate: outside ? draft.toDate : e.target.value })}
            />
          </Field>
          {outside && (
            <Field label="Return date" required>
              <input type="date" className="field" value={draft.toDate} onChange={(e) => set({ toDate: e.target.value })} />
            </Field>
          )}

          {/* Inside-city says where it went above, beside the city. */}
          {outside && (
            <>
              <Field label="Destination" hint="Filled in from the route — change it to name the actual place">
                <input
                  className="field"
                  value={draft.destination}
                  onChange={(e) => set({ destination: e.target.value })}
                  placeholder="Sylhet regional office"
                />
              </Field>
              <Field label="Purpose" required>
                <input
                  className="field"
                  value={draft.purpose}
                  onChange={(e) => set({ purpose: e.target.value })}
                  placeholder="Partner meeting, campus activation…"
                />
              </Field>
            </>
          )}
        </div>
      </Card>

      {!outside && (
        <Card
          title="Working hours"
          subtitle="Worked out from these two times — TA, Per-Diem or both follow from them."
        >
          {/* A trip to one of our own offices is checked against the attendance
              record, so the punches are what make the claim provable. Said here,
              above the times, rather than only in the panel on the right. */}
          {destinationNeeds === "office" && (
            <div className="mb-4">
              <Notice
                tone="warn"
                items={[
                  "You must punch the card both in and out at the office. Without both punches this claim will be rejected.",
                ]}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" required>
              <input type="time" className="field" value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End time" required>
              <input type="time" className="field" value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>
        </Card>
      )}

      <Card title="Who is travelling?">
        <ChoiceGrid
          value={draft.travelType}
          onChange={(travelType) => set({ travelType, teamMembers: travelType === "individual" ? [] : draft.teamMembers })}
          options={[
            { value: "individual", label: "Individual", description: `Just you — Band ${user.band}` },
            { value: "team", label: "Team", description: "Add colleagues travelling with you" },
          ]}
        />
        {draft.travelType === "team" && (
          <div className="mt-5">
            <TeamPicker
              members={draft.teamMembers}
              onChange={(teamMembers) => set({ teamMembers })}
              excludeId={user.employeeId}
            />
          </div>
        )}
      </Card>
    </>
  );
}

function TeamPicker({
  members, onChange, excludeId,
}: { members: TeamMember[]; onChange: (m: TeamMember[]) => void; excludeId: string }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<TeamMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const query = q.trim();

  /**
   * Debounced lookup, and the query is the ONLY dependency on purpose: adding a
   * member changes the parent's state, and if that re-ran this effect it would
   * cancel the in-flight search and blank the list. Nothing is fetched or shown
   * until the employee actually types.
   */
  useEffect(() => {
    if (!query) {
      setFound([]);
      setSearching(false);
      setError("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const { employees } = await api.employees(query);
        if (cancelled) return;
        setFound(employees.map((e) => ({
          employeeId: e.employeeId,
          name: e.name,
          department: e.department,
          designation: e.designation,
          band: e.band,
          gender: e.gender,
          // Left blank rather than pulled from their record: the search
          // endpoint answers on every keystroke, and returning someone's
          // personal payout number just for typing their name is a wider leak
          // than this picker should cause. The claimant enters it by hand.
          bkashNumber: "",
        })));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Yourself and anyone already added are filtered out at render time, not
  // inside the fetch, so the list stays correct as members are added.
  const results = found.filter(
    (e) => e.employeeId !== excludeId && !members.some((m) => m.employeeId === e.employeeId),
  );

  return (
    <div className="space-y-3">
      <Field label="Add members" hint="Tap a name to add them. Search by employee ID or name — department, designation and band fill in automatically.">
        <SearchInput
          value={q}
          onChange={setQ}
          busy={searching}
          placeholder="Search by name or employee ID"
        />
      </Field>

      {error && <Notice tone="error" items={[error]} />}

      {/* Nothing is shown until the employee types — the roster is not a list
          to browse, it is a thing to search. */}
      {query && !error && !searching && results.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Nobody matches “{query}”. Try the employee ID, or part of the name.
        </p>
      )}

      {query && results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {results.map((r) => (
            <li key={r.employeeId}>
              <button
                type="button"
                onClick={() => {
                  onChange([...members, r]);
                  setQ("");
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium text-slate-800">{r.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{r.employeeId} · {r.designation}</span>
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  Band {r.band}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {members.length > 0 && (
        <>
          {/* Phones: a card per member — five columns will not fit. */}
          <ul className="space-y-2 sm:hidden">
            {members.map((m) => (
              <li key={m.employeeId} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{m.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{m.employeeId} · Band {m.band}</p>
                  <p className="truncate text-xs text-slate-400">{m.designation} · {m.department}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(members.filter((x) => x.employeeId !== m.employeeId))}
                  className="shrink-0 rounded-lg p-2 text-slate-400 active:bg-rose-50 active:text-rose-600"
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">Department</th>
                  <th className="px-3 py-2 font-semibold">Designation</th>
                  <th className="px-3 py-2 font-semibold">Band</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.employeeId}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{m.employeeId}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{m.department}</td>
                    <td className="px-3 py-2 text-slate-600">{m.designation}</td>
                    <td className="px-3 py-2 text-slate-600">{m.band}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onChange(members.filter((x) => x.employeeId !== m.employeeId))}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Users size={14} /> {members.length + 1} traveller(s) including you.
      </p>
    </div>
  );
}

// ── Step 3 ──────────────────────────────────────────────────────────────────

function StepTransport({
  draft, set, policy, modes, user, currency, impliedCount,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  policy: Policy;
  modes: ModeOption[];
  user: SessionUser;
  currency: string;
  impliedCount: number;
}) {
  const inside = draft.scope === "inside";
  const juniorMale = inside && !String(user.gender).toLowerCase().startsWith("f") &&
    modes.some((m) => m.mode === "Car" && !m.enabled && m.reason.includes("pre-approval"));
  // A rickshaw fare has no receipt to reimburse against — say so rather than
  // repeating a line that only applies to the modes that do issue one.
  const modeNeedsReceipt = !!modes.find((m) => m.mode === draft.transportMode)?.requiresReceipt;

  return (
    <>
      <Card
        title="How did you travel?"
        subtitle={`Only the options your Band ${user.band} policy allows are shown${draft.travelType === "team" ? `, adjusted for a team of ${draft.teamMembers.length + 1}` : ""}.`}
      >
        <ChoiceGrid
          columns={4}
          value={draft.transportMode}
          onChange={(transportMode) => set({ transportMode, legs: [] })}
          options={modes.map((m) => ({
            value: m.mode,
            label: m.label,
            disabled: !m.enabled,
            reason: m.reason,
          }))}
        />

        {juniorMale && (
          <div className="mt-4">
            <Toggle
              checked={draft.carSpecialApproval}
              onChange={(carSpecialApproval) => set({ carSpecialApproval })}
              label="Car was pre-approved for this trip"
              hint="Attach the approval mail in the Documents step — Administration will verify it."
            />
          </div>
        )}
      </Card>

      {draft.transportMode === "CompanyVehicle" && (
        <Notice tone="info" items={["A company vehicle was used, so no transport reimbursement is payable for this trip."]} />
      )}

      {draft.transportMode === "PersonalVehicle" && (
        <Card title="Personal vehicle" subtitle="Reimbursement = total KM × the fuel rate configured by Administration.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vehicle type" required>
              <select className="field" value={draft.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })}>
                <option value="">Select</option>
                <option value="Bike">Own Bike</option>
                <option value="Car">Own Car</option>
              </select>
            </Field>
            <Field label="Total KM" required>
              <input
                type="number"
                min={0}
                className="field"
                value={draft.totalKM || ""}
                onChange={(e) => set({ totalKM: Number(e.target.value) })}
              />
            </Field>
            <Field label="Travel from" required>
              <input className="field" value={draft.travelFrom} onChange={(e) => set({ travelFrom: e.target.value })} />
            </Field>
            <Field label="Travel to" required>
              <input className="field" value={draft.travelTo} onChange={(e) => set({ travelTo: e.target.value })} />
            </Field>
          </div>
          {draft.vehicleType && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {draft.totalKM || 0} km × {fuelRateFor(policy, draft.vehicleType)} {currency}/km ={" "}
              <span className="font-semibold text-slate-900">
                <Money value={(draft.totalKM || 0) * fuelRateFor(policy, draft.vehicleType)} currency={currency} />
              </span>
            </p>
          )}
        </Card>
      )}

      {inside && draft.transportMode && !["CompanyVehicle", "PersonalVehicle"].includes(draft.transportMode) && (
        <Card title="One way, or there and back?">
          <ChoiceGrid
            value={draft.tripDirection}
            onChange={(tripDirection) => set({ tripDirection: tripDirection as RequestDraft["tripDirection"] })}
            options={[
              { value: "one_way", label: "One way", description: "Office to the destination — a single fare." },
              { value: "two_way", label: "Two way", description: "Office to the destination, and back to office — two fares." },
            ]}
          />
        </Card>
      )}

      {draft.transportMode && !["CompanyVehicle", "PersonalVehicle"].includes(draft.transportMode) && (
        <LegsEditor
          draft={draft}
          set={set}
          currency={currency}
          autoCount={impliedCount}
          title={inside ? "Trips taken" : "Travel tickets"}
          subtitle={
            inside
              ? modeNeedsReceipt
                ? "Filled in from your travel date and destination — just enter what each trip cost. Reimbursed against actual receipts."
                : "Filled in from your travel date and destination — just enter what each trip cost. No receipt needed for this mode."
              : "Filled in from your route and dates — just enter what each ticket cost. Attach the receipts in the Documents step."
          }
        />
      )}

      {inside && (
      <Card title="Any exception?">
        <div className="space-y-3">
          <Toggle
            checked={draft.exceptionClaimed}
            onChange={(exceptionClaimed) =>
              set({ exceptionClaimed, exceptionReason: exceptionClaimed ? draft.exceptionReason : "" })
            }
            label="I had to travel outside my band's transport policy"
            hint="Only when the trip genuinely left no choice — a late-night journey where a car was the safe option, for example. Ticking this opens every mode your band would otherwise not allow."
          />
          {draft.exceptionClaimed && (
            <>
              <Field label="Why was this necessary?" required>
                <textarea
                  className="field min-h-20"
                  value={draft.exceptionReason}
                  onChange={(e) => set({ exceptionReason: e.target.value })}
                  placeholder="Returned from the Uttara shoot at 1:30am — no CNG or rickshaw available at that hour, so a car was the only safe way home."
                />
              </Field>
              <Notice
                tone="warn"
                items={[
                  "An approver reads this and decides. Without a reason that stands up, the claim comes back — so say what happened, when, and why the usual option was not available.",
                ]}
              />
            </>
          )}
        </div>
      </Card>
      )}
    </>
  );
}

function LegsEditor({
  draft, set, currency, title, subtitle, autoCount,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  currency: string;
  title: string;
  subtitle: string;
  /** How many leading trips the form worked out for itself. */
  autoCount: number;
}) {
  const legs = draft.legs;
  const update = (i: number, patch: Partial<Leg>) =>
    set({ legs: legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const remove = (i: number) => set({ legs: legs.filter((_, idx) => idx !== i) });

  const amount = (leg: Leg, i: number) => (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      className="field"
      placeholder={`Amount (${currency})`}
      value={leg.amount || ""}
      onChange={(e) => update(i, { amount: Number(e.target.value) })}
    />
  );

  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        <button
          className="btn-ghost !px-3 !py-1.5 text-xs"
          onClick={() =>
            set({
              legs: [
                ...legs,
                { travelDate: draft.fromDate, mode: draft.transportMode, travelFrom: "", travelTo: "", amount: 0, note: "" },
              ],
            })
          }
        >
          <Plus size={14} /> Add another trip
        </button>
      }
    >
      {!legs.length ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Choose your dates and destination first — the trip is filled in from those.
        </p>
      ) : (
        <div className="space-y-3">
          {legs.map((leg, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              {i < autoCount ? (
                /* Worked out from the trip already described, so there is
                   nothing here to re-enter but the fare. */
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {leg.travelFrom || "—"} → {leg.travelTo || "—"}
                    </p>
                    <p className="text-xs text-slate-500">{leg.travelDate || "—"}</p>
                  </div>
                  <div className="w-32 shrink-0">{amount(leg, i)}</div>
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between sm:hidden">
                    <span className="text-xs font-bold text-slate-500">Trip {i + 1}</span>
                    <button
                      onClick={() => remove(i)}
                      className="rounded-lg p-2 text-slate-400 active:bg-rose-50 active:text-rose-600"
                      aria-label="Remove trip"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-[9rem_1fr_1fr_8rem_auto] sm:items-center sm:gap-3">
                    <input type="date" className="field" value={leg.travelDate} onChange={(e) => update(i, { travelDate: e.target.value })} />
                    <input className="field" placeholder="From" value={leg.travelFrom} onChange={(e) => update(i, { travelFrom: e.target.value })} />
                    <input className="field" placeholder="To" value={leg.travelTo} onChange={(e) => update(i, { travelTo: e.target.value })} />
                    {amount(leg, i)}
                    <button
                      onClick={() => remove(i)}
                      className="hidden rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:block"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          <p className="text-right text-sm font-semibold text-slate-700">
            Total: <Money value={legs.reduce((s, l) => s + (Number(l.amount) || 0), 0)} currency={currency} />
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Step 4 ──────────────────────────────────────────────────────────────────

function StepAllowances({
  draft, set, policy, user, computation, currency,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  policy: Policy;
  user: SessionUser;
  computation: ReturnType<typeof computeRequest>;
  currency: string;
}) {
  const inside = draft.scope === "inside";
  const minHours = cfgNum(policy, "PER_DIEM_MIN_HOURS", 5);
  const band = policy.bands.find((b) => b.band === user.band);

  if (inside) {
    return (
      <>
        {(
          <Card
            title="Per-Diem & meals"
            subtitle={`You worked ${computation.workingHours} hour(s). Eligibility is decided by the system, not by you.`}
          >
            <div className="space-y-3">
              {computation.perDiemEligible ? (
                <Notice
                  tone="info"
                  items={[
                    `Per-Diem of ${currency} ${computation.perDiemAmount} is approved automatically (≥ ${minHours} hours). Lunch is included, so lunch allowance is switched off.`,
                  ]}
                />
              ) : (
                <>
                  <Toggle
                    checked={draft.workedDuringLunch}
                    onChange={(workedDuringLunch) => set({ workedDuringLunch })}
                    label="Did you work during lunch time?"
                    hint={`Under ${minHours} hours, working through lunch qualifies for the lunch allowance.`}
                  />
                  <Toggle
                    checked={draft.dualWorkstation ? true : draft.officeMealTaken}
                    disabled={draft.dualWorkstation}
                    onChange={(officeMealTaken) => set({ officeMealTaken })}
                    label="Office meal taken?"
                    hint="If the office provided a meal, lunch allowance is not payable — no duplicate meal claims."
                  />
                </>
              )}
            </div>
          </Card>
        )}

      </>
    );
  }

  // Outside city.
  const advanceMinDays = cfgNum(policy, "ADVANCE_MIN_TRIP_DAYS", 3);
  return (
    <>
      <Card title="Per-Diem" subtitle="Loaded automatically from your band — no manual calculation.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Trip length" value={`${computation.tripDays} day(s)`} />
          <Stat label="Weekday rate" value={`${currency} ${band?.outsideTAWeekday ?? 0}`} />
          <Stat label="Weekend rate" value={`${currency} ${band?.outsideTAWeekend ?? 0}`} />
        </div>
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {computation.weekdayDays} weekday + {computation.weekendDays} weekend ={" "}
          <span className="font-semibold text-slate-900">
            <Money value={computation.perDiemAmount} currency={currency} />
          </span>
          . This already covers local transport and 3 meals, so no separate TA is claimed.
        </p>
      </Card>

      <Card title="Accommodation" subtitle={`Actual hotel bill, up to ${currency} ${band?.accommodationLimit ?? 0} per night for Band ${user.band}.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hotel name">
            <input className="field" value={draft.hotelName} onChange={(e) => set({ hotelName: e.target.value })} />
          </Field>
          <Field label={`Amount (${currency})`}>
            <input
              type="number"
              min={0}
              className="field"
              value={draft.accommodationAmount || ""}
              onChange={(e) => set({ accommodationAmount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Check-in">
            <input type="date" className="field" value={draft.checkIn} onChange={(e) => set({ checkIn: e.target.value })} />
          </Field>
          <Field label="Check-out">
            <input type="date" className="field" value={draft.checkOut} onChange={(e) => set({ checkOut: e.target.value })} />
          </Field>
        </div>
      </Card>

      {/* Only the costs this trip can actually have. A bus, train, launch or
          personal-vehicle journey has no car-pool split and no air fare, so the
          whole section stays away rather than showing empty boxes. */}
      {["RentACar", "Flight", "RideSharing"].includes(draft.transportMode) && (
      <Card title="Other costs">
        <div className="grid gap-4 sm:grid-cols-2">
          {["RentACar", "RideSharing"].includes(draft.transportMode) && (
            <>
              <Field
                label={`${draft.transportMode === "RideSharing" ? "Shared car" : "Rent-a-car"} amount (${currency})`}
                hint={`Needs at least ${cfgNum(policy, "RENT_A_CAR_MIN_HEADCOUNT", 3)} employees; limit ${currency} ${cfgNum(policy, "RENT_A_CAR_LIMIT", 6000)} one way.`}
              >
                <input
                  type="number"
                  min={0}
                  className="field"
                  value={draft.rentACarAmount || ""}
                  onChange={(e) => set({ rentACarAmount: Number(e.target.value) })}
                />
              </Field>
              <Field label="Employees sharing the car">
                <input
                  type="number"
                  min={0}
                  className="field"
                  value={draft.rentACarHeadcount || ""}
                  onChange={(e) => set({ rentACarHeadcount: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
          {draft.transportMode === "Flight" && (
            <Field
              label={`Flight amount (${currency})`}
              hint={band?.flightEligible ? "Your band is flight-eligible." : `Band ${user.band} is not flight-eligible.`}
            >
              <input
                type="number"
                min={0}
                disabled={!band?.flightEligible}
                className="field"
                value={draft.flightAmount || ""}
                onChange={(e) => set({ flightAmount: Number(e.target.value) })}
              />
            </Field>
          )}
          <Field label={`Other amount (${currency})`} hint="Anything the categories above do not cover.">
            <input
              type="number"
              min={0}
              className="field"
              value={draft.otherAmount || ""}
              onChange={(e) => set({ otherAmount: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Card>
      )}

      <Card
        title="Travel advance"
        subtitle={
          computation.advanceAvailable
            ? `This trip is ${computation.tripDays} days, so you are eligible for a travel advance.`
            : !computation.noticeOK
              ? `An advance needs at least ${computation.noticeDaysRequired} business days' notice before travel.`
              : `An advance is only offered for outside-city trips of ${advanceMinDays} days or more.`
        }
      >
        {computation.advanceAvailable ? (
          <>
            <ChoiceGrid
              value={draft.advanceWanted ? "yes" : "no"}
              // Declining clears any figure already typed, so nothing is
              // requested by accident.
              onChange={(v) =>
                set({ advanceWanted: v === "yes", advanceRequested: v === "yes" ? draft.advanceRequested : 0 })
              }
              options={[
                { value: "yes", label: "Yes, I want an advance", description: "Paid before you travel, settled against this claim afterwards." },
                { value: "no", label: "No, thanks", description: "Pay your own way and claim it all back after the trip." },
              ]}
            />
            {draft.advanceWanted ? (
              <div className="mt-5">
                <Field label={`Advance needed (${currency})`}>
                  <input
                    type="number"
                    min={0}
                    className="field"
                    value={draft.advanceRequested || ""}
                    onChange={(e) => set({ advanceRequested: Number(e.target.value) })}
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-5">
                <Notice
                  tone="info"
                  items={[
                    `You are eligible but have declined. Nothing is paid up front — spend your own money on the trip and the full ${currency} amount comes back to you once this claim is approved.`,
                  ]}
                />
              </div>
            )}
          </>
        ) : !computation.noticeOK ? (
          <Notice
            tone="warn"
            items={[
              `Applied ${computation.noticeGiven} business day(s) before travel — an advance needs ` +
              `${computation.noticeDaysRequired} or more. There is not enough time left to pay one out before this trip. ` +
              "Contact Administration if it cannot wait.",
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Advances start at {advanceMinDays}-day trips. This one is {computation.tripDays} day(s).
          </p>
        )}
        {computation.requiresDeptHeadApproval && (
          <div className="mt-3">
            <Notice
              tone="warn"
              items={[
                `Above ${currency} ${cfgNum(policy, "ADVANCE_AUTO_LIMIT", 10000)}, this advance also needs Department Head approval.`,
              ]}
            />
          </div>
        )}

      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

// ── Step 5 ──────────────────────────────────────────────────────────────────

interface Upload {
  name: string;
  link: string;
  sizeBytes: number;
}

function StepDocuments({
  draft, set, documentTypes, payable, currency, bankAllowed, needsReceipt,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  documentTypes: string[];
  payable: number;
  currency: string;
  bankAllowed: boolean;
  /** False for a rickshaw fare or a personal-vehicle claim — neither issues one. */
  needsReceipt: boolean;
}) {
  // Names are only known for files uploaded in this session; a claim being
  // edited comes back with links alone, so those fall back to the URL.
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [progress, setProgress] = useState<{ name: string; pct: number }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [enabled, setEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    api.uploadConfig()
      .then((c) => { setEnabled(c.enabled); setMaxBytes(c.maxBytes); })
      .catch(() => {});
  }, []);

  const maxMB = Math.round(maxBytes / 1024 / 1024);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
  const nameFor = (link: string) => uploads.find((u) => u.link === link)?.name || link;

  async function accept(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    setErrors([]);

    const tooBig = files.filter((f) => f.size > maxBytes);
    if (tooBig.length) {
      setErrors(tooBig.map((f) => `${f.name} is ${mb(f.size)} — the limit is ${maxMB} MB.`));
    }
    const queue = files.filter((f) => f.size <= maxBytes);
    if (!queue.length) return;

    setProgress(queue.map((f) => ({ name: f.name, pct: 0 })));

    // Sequential on purpose: several 50 MB files at once would fight for
    // bandwidth and make every progress bar crawl.
    for (const file of queue) {
      try {
        const saved = await api.upload(file, draft.documentLinks.length + uploads.length, (fraction) => {
          setProgress((p) => p.map((x) => (x.name === file.name ? { ...x, pct: Math.round(fraction * 100) } : x)));
        });
        setUploads((u) => [...u, { name: saved.name, link: saved.link, sizeBytes: saved.sizeBytes }]);
        set({ documentLinks: [...draft.documentLinks, saved.link] });
        draft = { ...draft, documentLinks: [...draft.documentLinks, saved.link] };
      } catch (err) {
        setErrors((e) => [...e, `${file.name}: ${(err as Error).message}`]);
      } finally {
        setProgress((p) => p.filter((x) => x.name !== file.name));
      }
    }
  }

  function remove(link: string) {
    set({ documentLinks: draft.documentLinks.filter((l) => l !== link) });
    setUploads((u) => u.filter((x) => x.link !== link));
  }

  return (
    <>
      <Card
        title="Documents"
        subtitle={
          needsReceipt
            ? "Attach tickets, bills, receipts, invoices, hotel bills or approval mail. Files are stored in the shared Drive and renamed with your employee ID, name and date."
            : "Not required for this claim — a rickshaw fare and a personal-vehicle trip have no receipt to attach. Add one only if you have something worth keeping on file."
        }
      >
        <div className="space-y-4">
          {!needsReceipt && (
            <Notice
              tone="info"
              items={["Nothing here is required — you can submit this claim without attaching anything."]}
            />
          )}
          <Field
            label="Document types"
            required={needsReceipt}
            hint="Pick every type your files cover — you can select more than one."
          >
            <MultiSelect
              options={documentTypes}
              value={draft.documentTypes}
              onChange={(documentTypes) => set({ documentTypes })}
              placeholder="Select document types…"
            />
          </Field>

          {!enabled && (
            <Notice tone="warn" items={["File uploads are not configured on this deployment — DRIVE_FOLDER_ID is not set."]} />
          )}

          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
            }`}
          >
            <FileUp size={22} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Choose files, or drag them here</span>
            <span className="text-xs text-slate-500">
              Image, PDF, Word, Excel, CSV — any type · up to {maxMB} MB each · pick as many as you need
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              disabled={!enabled}
              onChange={(e) => { accept(e.target.files); e.target.value = ""; }}
            />
          </label>

          {progress.length > 0 && (
            <ul className="space-y-2 rounded-xl border border-slate-200 p-3">
              {progress.map((p) => (
                <li key={p.name}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{p.pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${p.pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {errors.length > 0 && <Notice tone="error" items={errors} />}

          {draft.documentLinks.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {draft.documentLinks.map((link) => {
                const up = uploads.find((u) => u.link === link);
                return (
                  <li key={link} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <FileText size={15} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-slate-700 hover:underline"
                      >
                        {nameFor(link)}
                      </a>
                      {up && <span className="text-xs text-slate-400">{mb(up.sizeBytes)}</span>}
                    </span>
                    <button
                      onClick={() => remove(link)}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title={draft.travelType === "team" ? "Where the payment goes" : "Your personal bKash number"}
        subtitle={
          draft.travelType === "team"
            ? `Team travel — each traveller is paid separately. ${draft.teamMembers.length + 1} numbers are needed.`
            : `Finance pays the approved amount here.${payable > 0 ? ` Right now that is ${currency} ${payable}.` : ""}`
        }
      >
        {/* Bank payment stays hidden until an administrator turns it on in
            Configuration, and bKash is simply the only option until then. */}
        {bankAllowed && (
          <div className="mb-5">
            <ChoiceGrid
              value={draft.payoutMethod}
              onChange={(payoutMethod) => set({ payoutMethod: payoutMethod as RequestDraft["payoutMethod"] })}
              options={[
                { value: "bkash", label: "bKash", description: "Paid to your personal bKash number." },
                { value: "bank", label: "Bank account", description: "Paid into your bank account." },
              ]}
            />
          </div>
        )}

        {draft.travelType === "team" && draft.payoutMethod !== "bank" && (
          <div className="mb-5 space-y-3 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team payout numbers</p>
            <Field label="Your bKash number" required={payable > 0}>
              <input
                className="field"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={14}
                placeholder="01712345678"
                value={draft.bkashNumber}
                onChange={(e) => set({ bkashNumber: e.target.value })}
              />
            </Field>
            {draft.teamMembers.map((m, i) => (
              <Field key={m.employeeId || i} label={`${m.name || "Team member " + (i + 1)}'s bKash number`} required={payable > 0}>
                <input
                  className="field"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder="01712345678"
                  value={m.bkashNumber}
                  onChange={(e) => {
                    const teamMembers = draft.teamMembers.map((x, idx) => (idx === i ? { ...x, bkashNumber: e.target.value } : x));
                    set({ teamMembers });
                  }}
                />
              </Field>
            ))}
          </div>
        )}

        {draft.payoutMethod === "bank" && bankAllowed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" required={payable > 0}>
              <input className="field" value={draft.bankName} onChange={(e) => set({ bankName: e.target.value })} />
            </Field>
            <Field label="Account name" required={payable > 0} hint="Exactly as the bank has it.">
              <input className="field" value={draft.bankAccountName} onChange={(e) => set({ bankAccountName: e.target.value })} />
            </Field>
            <Field label="Account number" required={payable > 0}>
              <input className="field" inputMode="numeric" value={draft.bankAccountNumber} onChange={(e) => set({ bankAccountNumber: e.target.value })} />
            </Field>
            <Field label="Routing number" required={payable > 0}>
              <input className="field" inputMode="numeric" value={draft.bankRoutingNumber} onChange={(e) => set({ bankRoutingNumber: e.target.value })} />
            </Field>
            <Field label="Branch" required={payable > 0}>
              <input className="field" value={draft.bankBranch} onChange={(e) => set({ bankBranch: e.target.value })} />
            </Field>
          </div>
        ) : (
          draft.travelType !== "team" && (
          <Field
            label="Your bKash number"
            required={payable > 0}
            hint="11 digits starting with 01. Pre-filled from your employee record — change it if the money should go somewhere else."
          >
            <input
              className="field"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={14}
              placeholder="01712345678"
              value={draft.bkashNumber}
              onChange={(e) => set({ bkashNumber: e.target.value })}
            />
          </Field>
          )
        )}
      </Card>

      <Card title="Note for the approvers">
        <textarea
          className="field min-h-24"
          value={draft.employeeNote}
          onChange={(e) => set({ employeeNote: e.target.value })}
          placeholder="Anything your line manager, Administration or Finance should know."
        />
      </Card>
    </>
  );
}

// ── Live summary rail ───────────────────────────────────────────────────────

function LiveSummary({
  computation, currency,
}: { computation: ReturnType<typeof computeRequest>; currency: string }) {
  // Collapsed by default on phones: the running total stays visible without
  // pushing the actual form off the screen. Always open from lg up.
  const [open, setOpen] = useState(false);

  const lines: [string, number][] = [
    ["Transportation", computation.taAmount],
    ["Per-Diem", computation.perDiemAmount],
    ["Lunch allowance", computation.lunchAllowance],
    ["Accommodation", computation.accommodationAmount],
    ["Rent-a-car", computation.rentACarAmount],
    ["Flight", computation.flightAmount],
    ["Other", computation.otherAmount],
  ];
  const hasLines = lines.some(([, v]) => v > 0);

  const body = (
    <>
      <div className="space-y-2 px-4 py-4 text-sm sm:px-5">
        {lines.filter(([, v]) => v > 0).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-slate-600">{label}</span>
            <span className="font-medium text-slate-800"><Money value={value} currency={currency} /></span>
          </div>
        ))}
        {!hasLines && <p className="text-slate-400">Nothing calculated yet.</p>}
        <div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3">
          <span className="font-semibold text-slate-700">Total claim</span>
          <span className="font-bold text-slate-900"><Money value={computation.totalClaim} currency={currency} /></span>
        </div>
        {computation.advanceRequested > 0 && (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-slate-600">Less advance</span>
              <span className="font-medium text-rose-600">
                − <Money value={computation.advanceRequested} currency={currency} />
              </span>
            </div>
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-700">Final payable</span>
              <span className="font-bold text-emerald-600"><Money value={computation.finalPayable} currency={currency} /></span>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4 sm:px-5">
        <Notice tone="error" title="Fix before submitting" items={computation.errors} />
        <Notice tone="warn" title="Needs attention" items={computation.warnings} />
        <Notice tone="info" title="How this was calculated" items={computation.notes} />
      </div>
    </>
  );

  return (
    <aside className="order-first lg:sticky lg:top-6 lg:order-none lg:self-start">
      <div className="card overflow-hidden">
        {/* Phone header doubles as the toggle; desktop is a plain title. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left lg:cursor-default lg:px-5"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Live calculation</span>
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 lg:hidden">
              <Money value={computation.totalClaim} currency={currency} />
            </span>
            {computation.errors.length > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white lg:hidden">
                {computation.errors.length}
              </span>
            )}
            <ChevronDown
              size={16}
              className={`text-slate-400 transition-transform lg:hidden ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>

        <div className={open ? "block" : "hidden lg:block"}>{body}</div>
      </div>
    </aside>
  );
}
