import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, FileText, FileUp, Loader2, Plus, Send, Trash2, Users,
} from "lucide-react";
import { api } from "../api.js";
import {
  addDays, bankPayoutAllowed, cfgNum, cfgStr, computeRequest, eligibleModes, emptyDraft,
  impliedLegs, money, personalVehicleRateFor, todayISO, type ModeOption,
} from "../../shared/policy.js";
import type { Leg, Policy, RequestDraft, SessionUser, TeamMember, VehicleRegistration } from "../../shared/types.js";
import { Card, ChoiceGrid, Field, Modal, Money, MultiSelect, Notice, SearchInput, Spinner, Toggle } from "./ui.js";
import { VehicleRegisterForm } from "./VehicleRegister.js";

const STEPS = ["Travel Type", "Transportation", "Allowances", "Documents"];

/** A plain ISO date, read the way a person would say it — "22 Aug 2026". */
function fmtDate(date: string | undefined): string {
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

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
  // Next/Back swaps in an entirely different set of fields; staying scrolled
  // to wherever the previous step left off — often the bottom, since that is
  // where the button just clicked lives — showed the new step's middle with
  // nothing above it to explain what was on screen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editing?.draft) return editing.draft;
    // Pre-fill the payout number from the Employees sheet so most people only
    // have to confirm it.
    const start = emptyDraft("inside");
    return { ...start, bkashNumber: user.accountNumber || "" };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // undefined = still loading, null = never registered one.
  const [myVehicle, setMyVehicle] = useState<VehicleRegistration | null | undefined>(undefined);
  useEffect(() => {
    api.myVehicle().then((r) => setMyVehicle(r.vehicle)).catch(() => setMyVehicle(null));
  }, []);

  const currency = cfgStr(policy, "CURRENCY", "BDT");
  const set = (patch: Partial<RequestDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const teamSize = draft.travelType === "team" ? draft.teamMembers.length + 1 : 1;
  // The rate a personal-vehicle claim prices against comes from this specific
  // employee's own approved registration — never a pending or rejected one —
  // so it rides along on a copy of `user` rather than changing what
  // computeRequest's signature expects.
  const effectiveUser = useMemo(
    () => ({
      ...user,
      registeredVehicle: myVehicle?.status === "approved"
        ? {
          vehicleType: myVehicle.vehicleType, model: myVehicle.model,
          fuelType: myVehicle.fuelType, mileageKmPerLitre: myVehicle.mileageKmPerLitre,
        }
        : undefined,
    }),
    [user, myVehicle],
  );
  const computation = useMemo(
    () => computeRequest(policy, draft, effectiveUser),
    [policy, draft, effectiveUser],
  );
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
    policy, draft.scope, draft.fromDate, draft.toDate,
    draft.city, draft.route, draft.destination, draft.destinationType, draft.tripDirection, draft.purpose,
  ]);
  const impliedKey = implied.map((l) => [l.travelDate, l.mode, l.travelFrom, l.travelTo].join("|")).join("\n");
  // How many legs were auto-generated last time this ran — e.g. switching a
  // two-way trip back to one-way shrinks the auto portion. Legs between the
  // new and old count were themselves auto-generated and are now stale, not
  // something the person added by hand, so they are dropped rather than left
  // behind as a lookalike "manual" trip with its own amount box.
  const prevAutoCountRef = useRef(0);
  useEffect(() => {
    const keepFrom = Math.max(prevAutoCountRef.current, implied.length);
    setDraft((d) => {
      const kept = d.legs.slice(keepFrom);
      const merged = implied.map((l, i) => ({
        ...l, mode: d.legs[i]?.mode || l.mode, amount: d.legs[i]?.amount ?? 0, note: d.legs[i]?.note ?? "",
      }));
      return { ...d, legs: [...merged, ...kept] };
    });
    prevAutoCountRef.current = implied.length;
  }, [impliedKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
              myVehicle={myVehicle} onVehicleChange={setMyVehicle}
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
              user={user}
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

        <LiveSummary computation={computation} currency={currency} draft={draft} user={user} />
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

  // A claim has to be filed within this many days of the trip ending —
  // inside city, that is the travel date itself; outside city, the return.
  // Administration can lift this per person from Configuration, which is
  // exactly what unlocks the calendar back open here too.
  const claimWindowDays = cfgNum(policy, "CLAIM_WINDOW_DAYS", 7);
  const claimWindowUnlocked = !!(user.claimUnlockUntil && todayISO() <= user.claimUnlockUntil);
  const earliestClaimableDate = claimWindowUnlocked ? "" : addDays(todayISO(), -claimWindowDays);

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
                    const touchesDhaka = picked?.from === "Dhaka" || picked?.to === "Dhaka";
                    set({
                      route: e.target.value,
                      city: picked?.to || "",
                      destination: picked?.to || "",
                      dhakaOffice: touchesDhaka ? draft.dhakaOffice : "",
                    });
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

              {/* Dhaka has several offices to choose between; Chattogram, so
                  far, does not. */}
              {route && (route.from === "Dhaka" || route.to === "Dhaka") && (
                <Field label="Dhaka office" required>
                  <select className="field" value={draft.dhakaOffice} onChange={(e) => set({ dhakaOffice: e.target.value })}>
                    <option value="">Select an office</option>
                    {policy.otherOffices.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
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

          <Field
            label={outside ? "Departure date" : "Travel date"}
            required
            hint={
              !outside
                ? claimWindowUnlocked
                  ? `Administration has unlocked late filing for you until ${fmtDate(user.claimUnlockUntil)} — any date is fine.`
                  : `Claims must be filed within ${claimWindowDays} days of travel, so the calendar only goes back to ${fmtDate(earliestClaimableDate)}. Need an older date? Reach out to Administration.`
                : undefined
            }
          >
            <input
              type="date"
              className="field"
              value={draft.fromDate}
              min={!outside ? earliestClaimableDate || undefined : undefined}
              onChange={(e) => set({ fromDate: e.target.value, toDate: outside ? draft.toDate : e.target.value })}
            />
          </Field>
          {outside && (
            <Field
              label="Return date"
              required
              hint={
                claimWindowUnlocked
                  ? `Administration has unlocked late filing for you until ${fmtDate(user.claimUnlockUntil)} — any date is fine.`
                  : `Claims must be filed within ${claimWindowDays} days of your return, so the calendar only goes back to ${fmtDate(earliestClaimableDate)}. Need an older date? Reach out to Administration.`
              }
            >
              <input
                type="date"
                className="field"
                value={draft.toDate}
                min={earliestClaimableDate || undefined}
                onChange={(e) => set({ toDate: e.target.value })}
              />
            </Field>
          )}

          <div className="sm:col-span-2">
            <Notice
              tone="warn"
              items={[
                "Enter your travel date exactly as it happened — a manipulated or falsified date is grounds for rejecting this request.",
              ]}
            />
          </div>

          {draft.scope === "outside" && (
            <Field label="Travel arrangement" required>
              <select
                className="field"
                value={draft.arrangement}
                // Company Arrangement means the company books the hotel
                // directly, so any hotel figures already entered no longer
                // apply.
                onChange={(e) => {
                  const arrangement = e.target.value as RequestDraft["arrangement"];
                  set(
                    arrangement === "company"
                      ? { arrangement, accommodationType: "", hotelName: "", checkIn: "", checkOut: "", accommodationAmount: 0 }
                      : { arrangement },
                  );
                }}
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
          <div className="mt-4">
            <Toggle
              checked={draft.dualWorkstation ? true : draft.officeMealTaken}
              disabled={draft.dualWorkstation}
              onChange={(officeMealTaken) => set({ officeMealTaken })}
              label="Office meal taken?"
              hint={`If the office provided a meal, ${cfgNum(policy, "OFFICE_MEAL_DEDUCTION", 75)} ${cfgStr(policy, "CURRENCY", "BDT")} is deducted from your Per-Diem — otherwise the full amount is paid.`}
            />
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
  draft, set, policy, modes, user, currency, impliedCount, myVehicle, onVehicleChange,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  policy: Policy;
  modes: ModeOption[];
  user: SessionUser;
  currency: string;
  impliedCount: number;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
}) {
  const inside = draft.scope === "inside";
  const juniorMale = inside && !String(user.gender).toLowerCase().startsWith("f") &&
    modes.some((m) => m.mode === "Car" && !m.enabled && m.reason.includes("pre-approval"));
  const anyLegNeedsReceipt = draft.legs.some((l) => modes.find((m) => m.mode === l.mode)?.requiresReceipt);

  return (
    <>
      <Card
        title="One way, or there and back?"
        subtitle={`Only the modes your Band ${user.band} policy allows are offered per trip below${draft.travelType === "team" ? `, adjusted for a team of ${draft.teamMembers.length + 1}` : ""}.`}
      >
        <ChoiceGrid
          columns={3}
          value={draft.tripDirection}
          onChange={(tripDirection) =>
            set({
              tripDirection: tripDirection as RequestDraft["tripDirection"],
              // Stepping back out of More Ways drops whatever extra stops
              // were chained on — One way and Two way have no "add" button
              // to remove them with otherwise.
              legs: tripDirection === "more_ways" ? draft.legs : draft.legs.slice(0, impliedCount),
            })
          }
          options={
            inside
              ? [
                  { value: "one_way", label: "One way", description: "Office to the destination — a single fare." },
                  { value: "two_way", label: "Two way", description: "Office to the destination, and back to office — two fares." },
                  { value: "more_ways", label: "More Ways", description: "Several stops in one trip — add each leg as you go." },
                ]
              : [
                  { value: "one_way", label: "One way", description: "Departure only — a single ticket." },
                  { value: "two_way", label: "Two way", description: "There and back — two tickets." },
                  { value: "more_ways", label: "More Ways", description: "Several stops on the way — add each leg as you go." },
                ]
          }
        />
      </Card>

      <LegsEditor
        draft={draft}
        set={set}
        currency={currency}
        autoCount={impliedCount}
        // One way and Two way are exactly the fare(s) the trip implies —
        // nothing to add by hand. More Ways is a chain of stops the
        // traveller builds up themselves, so each new leg starts where the
        // last one left off rather than blank.
        chained={draft.tripDirection === "more_ways"}
        legModes={modes}
        policy={policy}
        myVehicle={myVehicle}
        onVehicleChange={onVehicleChange}
        title={inside ? "Trips taken" : "Travel tickets"}
        subtitle={
          anyLegNeedsReceipt
            ? "Pick each trip's mode and enter what it cost — reimbursed against actual receipts where one is issued."
            : "Pick each trip's mode and enter what it cost — no receipt needed for the modes used so far."
        }
      />

      {juniorMale && (
        <Toggle
          checked={draft.carSpecialApproval}
          onChange={(carSpecialApproval) => set({ carSpecialApproval })}
          label="Car was pre-approved for this trip"
          hint="Attach the approval mail in the Documents step — Administration will verify it."
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

// ── Personal vehicle: register once, HR/Admin approve, then claim against it ──

/** Priced per traveller, not per trip — kept in step with the same set in policy.ts. */
const PER_TRAVELLER_MODES = new Set(["Bus", "Train", "Flight"]);

function LegsEditor({
  draft, set, currency, title, subtitle, autoCount, chained = false, legModes, policy, myVehicle, onVehicleChange,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  currency: string;
  title: string;
  subtitle: string;
  /** How many leading trips the form worked out for itself. */
  autoCount: number;
  /** More Ways only: lets a trip be added by hand, each one chained from the last. */
  chained?: boolean;
  legModes?: ModeOption[];
  policy: Policy;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
}) {
  const legs = draft.legs;
  const teamSize = draft.travelType === "team" ? draft.teamMembers.length + 1 : 1;
  const update = (i: number, patch: Partial<Leg>) =>
    set({ legs: legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const remove = (i: number) => set({ legs: legs.filter((_, idx) => idx !== i) });

  const [vehicleModalFor, setVehicleModalFor] = useState<number | null>(null);
  const [rentACarModalFor, setRentACarModalFor] = useState<number | null>(null);

  function changeMode(i: number, mode: string) {
    if (mode === "PersonalVehicle") {
      update(i, { mode, amount: 0 });
      setVehicleModalFor(i);
    } else if (mode === "RentACar") {
      update(i, { mode, amount: 0 });
      setRentACarModalFor(i);
    } else if (mode === "CompanyVehicle") {
      update(i, { mode, amount: 0, note: "Company vehicle — no reimbursement." });
    } else {
      update(i, { mode });
    }
  }

  const modeSelect = (leg: Leg, i: number) => (
    <select className="field" value={leg.mode} onChange={(e) => changeMode(i, e.target.value)}>
      <option value="">Mode</option>
      {(legModes || []).filter((m) => m.enabled).map((m) => (
        <option key={m.mode} value={m.mode}>{m.label}</option>
      ))}
    </select>
  );

  // What this leg's amount box actually is depends on the mode picked —
  // most are a plain fare, but the three "special" ones each hand off to
  // their own picker instead of a raw number.
  const amountCell = (leg: Leg, i: number) => {
    if (leg.mode === "CompanyVehicle") {
      return <p className="field flex items-center text-slate-400">Free — no cost</p>;
    }
    if (leg.mode === "PersonalVehicle" || leg.mode === "RentACar") {
      return (
        <button
          type="button"
          className="field flex items-center justify-between text-left"
          onClick={() => (leg.mode === "PersonalVehicle" ? setVehicleModalFor(i) : setRentACarModalFor(i))}
        >
          <span className={leg.amount > 0 ? "font-medium text-slate-800" : "text-slate-400"}>
            {leg.amount > 0 ? <Money value={leg.amount} currency={currency} /> : "Enter details"}
          </span>
          <ChevronDown size={14} className="-rotate-90 text-slate-400" />
        </button>
      );
    }
    const perTraveller = teamSize > 1 && PER_TRAVELLER_MODES.has(leg.mode);
    return (
      <div>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          className="field"
          placeholder={perTraveller ? `Per ticket (${currency})` : `Amount (${currency})`}
          value={leg.amount || ""}
          onChange={(e) => update(i, { amount: Number(e.target.value) })}
        />
        {perTraveller && leg.amount > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            {leg.amount} × {teamSize} travellers = <Money value={leg.amount * teamSize} currency={currency} />
          </p>
        )}
      </div>
    );
  };

  const legTotal = legs.reduce((sum, l) => {
    if (l.mode === "CompanyVehicle") return sum;
    const multiplier = teamSize > 1 && PER_TRAVELLER_MODES.has(l.mode) ? teamSize : 1;
    return sum + (Number(l.amount) || 0) * multiplier;
  }, 0);

  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        chained && (
          <button
            className="btn-ghost !px-3 !py-1.5 text-xs"
            onClick={() =>
              set({
                legs: [
                  ...legs,
                  {
                    travelDate: draft.fromDate,
                    // Chained trips continue from wherever the last leg left
                    // off, defaulting to the same mode too — both are still
                    // editable, but most multi-stop errands stay on one.
                    mode: legs[legs.length - 1]?.mode || "",
                    travelFrom: legs[legs.length - 1]?.travelTo || "",
                    travelTo: "",
                    amount: 0,
                    note: "",
                  },
                ],
              })
            }
          >
            <Plus size={14} /> Add another trip
          </button>
        )
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
                   nothing here to re-enter but the mode and the fare. */
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {leg.travelFrom || "—"} → {leg.travelTo || "—"}
                    </p>
                    <p className="text-xs text-slate-500">{leg.travelDate || "—"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="w-36">{modeSelect(leg, i)}</div>
                    <div className="w-40">{amountCell(leg, i)}</div>
                  </div>
                </div>
              ) : (
                /* A More Ways stop: same day, continuing from wherever the
                   last leg ended — only where it goes next is new. */
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
                  <div className="grid gap-2.5 sm:grid-cols-[8rem_1fr_1fr_9rem_10rem_auto] sm:items-center sm:gap-3">
                    <span className="text-sm text-slate-500">{leg.travelDate || "—"}</span>
                    <span className="truncate text-sm text-slate-600">{leg.travelFrom || "—"}</span>
                    <input
                      className="field"
                      placeholder="Where next?"
                      value={leg.travelTo}
                      onChange={(e) => update(i, { travelTo: e.target.value })}
                    />
                    {modeSelect(leg, i)}
                    {amountCell(leg, i)}
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
            Total: <Money value={legTotal} currency={currency} />
          </p>
        </div>
      )}

      {vehicleModalFor !== null && (
        <PersonalVehicleLegModal
          policy={policy}
          currency={currency}
          myVehicle={myVehicle}
          onVehicleChange={onVehicleChange}
          initial={legs[vehicleModalFor]}
          onClose={() => setVehicleModalFor(null)}
          onSave={(patch) => { update(vehicleModalFor, patch); setVehicleModalFor(null); }}
        />
      )}

      {rentACarModalFor !== null && (
        <RentACarLegModal
          policy={policy}
          currency={currency}
          initial={legs[rentACarModalFor]}
          headcount={draft.rentACarHeadcount}
          onClose={() => setRentACarModalFor(null)}
          onSave={(patch, headcount) => {
            update(rentACarModalFor, patch);
            set({ rentACarHeadcount: headcount });
            setRentACarModalFor(null);
          }}
        />
      )}
    </Card>
  );
}

function PersonalVehicleLegModal({
  policy, currency, myVehicle, onVehicleChange, initial, onClose, onSave,
}: {
  policy: Policy;
  currency: string;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
  initial: Leg;
  onClose: () => void;
  onSave: (patch: Partial<Leg>) => void;
}) {
  const [travelFrom, setTravelFrom] = useState(initial.travelFrom);
  const [travelTo, setTravelTo] = useState(initial.travelTo);
  const [km, setKm] = useState(0);
  const [editing, setEditing] = useState(false);

  if (myVehicle === undefined) {
    return (
      <Modal title="Personal vehicle" onClose={onClose}>
        <Spinner label="Checking your vehicle registration…" />
      </Modal>
    );
  }

  if (editing || !myVehicle || myVehicle.status !== "approved") {
    const submitted = (v: VehicleRegistration) => { setEditing(false); onVehicleChange(v); };
    return (
      <Modal title={myVehicle ? "Update your vehicle" : "Register your vehicle"} onClose={onClose}>
        <div className="space-y-4">
          {myVehicle?.status === "pending" && (
            <Notice tone="warn" items={["Still waiting on HR or Admin to approve this — you can claim against it once they do."]} />
          )}
          {myVehicle?.status === "rejected" && (
            <Notice
              tone="error"
              items={[`Not approved${myVehicle.reviewNote ? ` — ${myVehicle.reviewNote}` : ""}. Update the details and submit again.`]}
            />
          )}
          {!myVehicle && (
            <Notice tone="info" items={["Register your vehicle once here and HR or Admin approval unlocks every personal-vehicle trip after that."]} />
          )}
          <VehicleRegisterForm policy={policy} initial={myVehicle} onSubmitted={submitted} />
        </div>
      </Modal>
    );
  }

  // Approved.
  const fuel = policy.fuelTypes.find((f) => f.value === myVehicle.fuelType);
  const rate = fuel && myVehicle.mileageKmPerLitre > 0 ? fuel.pricePerLitre / myVehicle.mileageKmPerLitre : 0;
  const litres = myVehicle.mileageKmPerLitre > 0 ? km / myVehicle.mileageKmPerLitre : 0;
  const tripAmount = money(km * rate);

  return (
    <Modal title="Personal vehicle trip" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {myVehicle.vehicleType} — {myVehicle.model} · {myVehicle.fuelType}, {myVehicle.mileageKmPerLitre} km/l.{" "}
          <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setEditing(true)}>
            Update vehicle details
          </button>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Travel from" required>
            <input className="field" value={travelFrom} onChange={(e) => setTravelFrom(e.target.value)} />
          </Field>
          <Field label="Travel to" required>
            <input className="field" value={travelTo} onChange={(e) => setTravelTo(e.target.value)} />
          </Field>
          <Field label="Total KM" required>
            <input type="number" min={0} className="field" value={km || ""} onChange={(e) => setKm(Number(e.target.value))} />
          </Field>
        </div>
        {km > 0 && fuel && (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {km} km ÷ {myVehicle.mileageKmPerLitre} km/l = {litres.toFixed(2)} l of {myVehicle.fuelType} at {fuel.pricePerLitre} {currency}/l ={" "}
            <span className="font-semibold text-slate-900"><Money value={tripAmount} currency={currency} /></span>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!travelFrom.trim() || !travelTo.trim() || !(km > 0)}
            onClick={() => onSave({
              travelFrom, travelTo, amount: tripAmount,
              note: `${km} km via ${myVehicle.vehicleType} (${myVehicle.model}).`,
            })}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RentACarLegModal({
  policy, currency, initial, headcount, onClose, onSave,
}: {
  policy: Policy;
  currency: string;
  initial: Leg;
  headcount: number;
  onClose: () => void;
  onSave: (patch: Partial<Leg>, headcount: number) => void;
}) {
  const [amount, setAmount] = useState(initial.amount || 0);
  const [head, setHead] = useState(headcount || 0);
  const limit = cfgNum(policy, "RENT_A_CAR_LIMIT", 6000);
  const minHead = cfgNum(policy, "RENT_A_CAR_MIN_HEADCOUNT", 3);

  return (
    <Modal title="Rent-a-car" onClose={onClose}>
      <div className="space-y-4">
        <Notice
          tone="warn"
          items={[`Cannot exceed ${currency} ${limit} one way, and needs at least ${minHead} employees pooling together.`]}
        />
        <Field label={`Amount (${currency})`} required>
          <input
            type="number"
            min={0}
            max={limit}
            className="field"
            value={amount || ""}
            onChange={(e) => setAmount(Math.min(Number(e.target.value), limit))}
          />
        </Field>
        <Field label="Employees sharing the car" required>
          <input type="number" min={0} className="field" value={head || ""} onChange={(e) => setHead(Number(e.target.value))} />
        </Field>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!(amount > 0) || !(head >= minHead)}
            onClick={() => onSave({ amount, note: `Rent-a-car pooled across ${head} employees.` }, head)}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
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

  // "Full amount" tracks the claim total live, so it stays correct as the
  // claimant fills in the rest of the form after choosing it.
  useEffect(() => {
    if (draft.advanceWanted && draft.advanceType === "full" && draft.advanceRequested !== computation.totalClaim) {
      set({ advanceRequested: computation.totalClaim });
    }
  }, [draft.advanceWanted, draft.advanceType, computation.totalClaim]);

  if (inside) {
    return (
      <>
        <Card
          title="Per-Diem"
          subtitle={`You worked ${computation.workingHours} hour(s). Eligibility is decided by the system, not by you.`}
        >
          <Notice
            tone={computation.perDiemEligible ? "info" : "warn"}
            items={[
              computation.perDiemEligible
                ? `Per-Diem of ${currency} ${computation.perDiemAmount} is approved automatically (≥ ${minHours} hours).`
                : `No Per-Diem — you worked under ${minHours} hour(s).`,
            ]}
          />
        </Card>
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
        {draft.arrangement === "company" ? (
          <Notice
            tone="info"
            items={[
              "Company Arrangement — the company books your hotel directly, so there's nothing to claim here. " +
              "Got a receipt or other paperwork? Attach it on the Documents step instead.",
            ]}
          />
        ) : (
          <>
            <ChoiceGrid
              value={draft.accommodationType}
              // Switching to Personal clears any hotel figures already entered,
              // so nothing is claimed for a stay with no bill.
              onChange={(v) =>
                set(
                  v === "personal"
                    ? { accommodationType: "personal", hotelName: "", checkIn: "", checkOut: "", accommodationAmount: 0 }
                    : { accommodationType: "hotel" },
                )
              }
              options={[
                { value: "hotel", label: "Hotel", description: "Stayed at a hotel — claim the bill." },
                { value: "personal", label: "Personal", description: "Stayed with family or friends — no hotel bill to claim." },
              ]}
            />
            {draft.accommodationType !== "personal" && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
            )}
          </>
        )}
      </Card>

      <Card title="Other costs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Other amount (${currency})`} hint="Anything not covered by a trip's own fare — rent-a-car and flights are picked per trip, on the Transportation step.">
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
                set({
                  advanceWanted: v === "yes",
                  advanceType: v === "yes" ? draft.advanceType : "",
                  advanceRequested: v === "yes" ? draft.advanceRequested : 0,
                })
              }
              options={[
                { value: "yes", label: "Yes, I want an advance", description: "Paid before you travel, settled against this claim afterwards." },
                { value: "no", label: "No, thanks", description: "Pay your own way and claim it all back after the trip." },
              ]}
            />
            {draft.advanceWanted ? (
              <div className="mt-5 space-y-5">
                <ChoiceGrid
                  value={draft.advanceType}
                  onChange={(v) =>
                    set({
                      advanceType: v === "full" ? "full" : "partial",
                      advanceRequested: v === "full" ? computation.totalClaim : draft.advanceRequested,
                    })
                  }
                  options={[
                    { value: "full", label: "Full amount", description: "The whole claim total is requested as your advance." },
                    { value: "partial", label: "Partial amount", description: "Type in the specific amount you need up front." },
                  ]}
                />
                {draft.advanceType === "full" ? (
                  <Field label={`Advance needed (${currency})`}>
                    <input type="number" className="field" value={computation.totalClaim} disabled readOnly />
                  </Field>
                ) : draft.advanceType === "partial" ? (
                  <Field label={`Advance needed (${currency})`}>
                    <input
                      type="number"
                      min={0}
                      className="field"
                      value={draft.advanceRequested || ""}
                      onChange={(e) => set({ advanceRequested: Number(e.target.value) })}
                    />
                  </Field>
                ) : null}
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
  draft, set, documentTypes, payable, currency, bankAllowed, needsReceipt, user,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  documentTypes: string[];
  payable: number;
  currency: string;
  bankAllowed: boolean;
  /** False for a rickshaw fare or a personal-vehicle claim — neither issues one. */
  needsReceipt: boolean;
  user: SessionUser;
}) {
  // Names are only known for files uploaded in this session; a claim being
  // edited comes back with links alone, so those fall back to the URL.
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [progress, setProgress] = useState<{ name: string; pct: number }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [maxBytes, setMaxBytes] = useState(50 * 1024 * 1024);
  const [enabled, setEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);
  // Nothing to attach for a rickshaw fare or a personal-vehicle trip, so the
  // picker starts hidden rather than merely optional — an empty required-look
  // upload box was the thing people kept asking about. One click brings it
  // back for anyone who genuinely wants to attach something anyway.
  const [showUploader, setShowUploader] = useState(needsReceipt);

  // Whatever is on the employee record right now — starts open for editing
  // until there is something saved, then locks so it reads as confirmed
  // rather than as a field still waiting to be filled in.
  const [savedBkash, setSavedBkash] = useState(user.accountNumber || "");
  const [editingBkash, setEditingBkash] = useState(!savedBkash);
  const [savingBkash, setSavingBkash] = useState(false);
  const [bkashSaveError, setBkashSaveError] = useState("");

  async function saveBkash() {
    setSavingBkash(true);
    setBkashSaveError("");
    try {
      const { bkashNumber } = await api.saveBkashNumber(draft.bkashNumber);
      setSavedBkash(bkashNumber);
      setEditingBkash(false);
    } catch (err) {
      setBkashSaveError((err as Error).message);
    } finally {
      setSavingBkash(false);
    }
  }

  // Shared by the individual and team layouts — both ask for the submitter's
  // own number, just inside a differently-titled card.
  function myBkashField(required: boolean) {
    if (!editingBkash && savedBkash) {
      return (
        <Field label="Give your personal bKash number" required={required}>
          <div className="field flex items-center justify-between gap-2">
            <span className="font-mono text-slate-800">{savedBkash}</span>
            <button type="button" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline" onClick={() => setEditingBkash(true)}>
              Edit
            </button>
          </div>
        </Field>
      );
    }
    return (
      <Field label="Give your personal bKash number" required={required} hint="11 digits starting with 01.">
        <div className="flex flex-col gap-2 sm:flex-row">
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
          <button
            type="button"
            className="btn-ghost shrink-0 whitespace-nowrap text-xs"
            disabled={savingBkash || !draft.bkashNumber.trim()}
            onClick={saveBkash}
          >
            {savingBkash ? <Loader2 size={14} className="animate-spin" /> : null} Save this bKash number
          </button>
        </div>
        {bkashSaveError && <p className="mt-1.5 text-xs text-rose-600">{bkashSaveError}</p>}
      </Field>
    );
  }

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
          needsReceipt || showUploader
            ? "Attach tickets, bills, receipts, invoices, hotel bills or approval mail. Files are stored in the shared Drive and renamed with your employee ID, name and date."
            : "Not required for this claim."
        }
      >
        <div className="space-y-4">
          {!needsReceipt && !showUploader && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-sm text-slate-600">
                Nothing to attach — a rickshaw fare or a personal-vehicle trip has no receipt.
              </p>
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setShowUploader(true)}>
                Attach something anyway
              </button>
            </div>
          )}

          {(needsReceipt || showUploader) && (
            <>
              {!needsReceipt && (
                <Notice
                  tone="info"
                  items={["Still not required for this claim — attach one only if you have something worth keeping on file."]}
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
            </>
          )}

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
            {myBkashField(payable > 0)}
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
          draft.travelType !== "team" && myBkashField(payable > 0)
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
  computation, currency, draft, user,
}: { computation: ReturnType<typeof computeRequest>; currency: string; draft: RequestDraft; user: SessionUser }) {
  // Collapsed by default on phones: the running total stays visible without
  // pushing the actual form off the screen. Always open from lg up.
  const [open, setOpen] = useState(false);

  // Per-Diem is the only line split evenly per traveller — everything else
  // (transport, accommodation, rent-a-car…) is a single receipt or a flat
  // amount for the whole group, so only this one gets an itemised breakdown.
  const isTeam = draft.travelType === "team" && draft.teamMembers.length > 0;
  const teamSize = isTeam ? draft.teamMembers.length + 1 : 1;
  const perDiemPerHead = isTeam && teamSize > 0 ? computation.perDiemAmount / teamSize : 0;

  const lines: [string, number][] = [
    // Rent-a-car and Flight are trips too now, so their cost is already
    // folded into Transportation — showing them again here would look like
    // it was charged twice.
    ["Transportation", computation.taAmount],
    ...(isTeam ? [] : [["Per-Diem", computation.perDiemAmount] as [string, number]]),
    ["Lunch allowance", computation.lunchAllowance],
    ["Accommodation", computation.accommodationAmount],
    ["Other", computation.otherAmount],
  ];
  const hasLines = lines.some(([, v]) => v > 0) || (isTeam && computation.perDiemAmount > 0);

  const body = (
    <>
      <div className="space-y-2 px-4 py-4 text-sm sm:px-5">
        {isTeam && computation.perDiemAmount > 0 && (
          <div>
            <span className="mb-1 block text-slate-600">Per-Diem</span>
            <div className="space-y-1 border-l-2 border-slate-100 pl-3">
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-slate-500">{user.name} (you)</span>
                <span className="text-slate-700"><Money value={perDiemPerHead} currency={currency} /></span>
              </div>
              {draft.teamMembers.map((m, i) => (
                <div key={m.employeeId || i} className="flex justify-between gap-3 text-xs">
                  <span className="text-slate-500">{m.name || `Team member ${i + 1}`}</span>
                  <span className="text-slate-700"><Money value={perDiemPerHead} currency={currency} /></span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between gap-3">
              <span className="text-xs font-medium text-slate-500">Per-Diem total</span>
              <span className="font-medium text-slate-800"><Money value={computation.perDiemAmount} currency={currency} /></span>
            </div>
          </div>
        )}
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
