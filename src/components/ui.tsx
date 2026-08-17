/** Small shared presentational pieces used across every screen. */

import React from "react";
import {
  AlertTriangle, ChevronDown, ChevronsUpDown, Info, Loader2, LogOut, Search, UserRound, X,
} from "lucide-react";
import { STATUS_LABEL, STATUS_PROGRESS, type Status } from "../../shared/types.js";

export function Money({ value, currency = "BDT" }: { value: number; currency?: string }) {
  return (
    <span className="tabular-nums">
      {currency} {Number(value || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}
    </span>
  );
}

export function Field({
  label, children, hint, required,
}: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * The one search box used everywhere.
 *
 * The icons are centred with `top-1/2 -translate-y-1/2` rather than a fixed
 * offset, because `.field` is taller on phones than on desktop — a fixed `top`
 * lands the icon off-centre on one of them. `pointer-events-none` means a tap
 * on the icon still focuses the input instead of doing nothing.
 */
export function SearchInput({
  value, onChange, placeholder, busy, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        className="field pl-9 pr-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {busy && (
        <Loader2
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
        />
      )}
    </div>
  );
}

export function Card({
  title, subtitle, children, actions, className = "",
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5 sm:py-4">
          <div>
            {title && <h2 className="text-sm font-bold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  manager_review: "bg-amber-50 text-amber-700 ring-amber-200",
  admin_review: "bg-amber-50 text-amber-700 ring-amber-200",
  finance_review: "bg-sky-50 text-sky-700 ring-sky-200",
  payment_processing: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  payment_disputed: "bg-rose-50 text-rose-700 ring-rose-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  returned: "bg-orange-50 text-orange-700 ring-orange-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function ProgressBar({ status }: { status: Status }) {
  const pct = STATUS_PROGRESS[status] ?? 0;
  const tone = status === "rejected" ? "bg-rose-500" : status === "returned" ? "bg-orange-400" : "bg-brand-600";
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}

export function Notice({
  tone = "info", title, items,
}: { tone?: "info" | "warn" | "error"; title?: string; items: string[] }) {
  if (!items.length) return null;
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
  }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <div className="flex gap-2">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {title && <p className="mb-1.5 font-semibold">{title}</p>}
          {/* Several points ran together as one paragraph without a marker:
              each wrapped onto the next line and nothing showed where one
              ended. The dot is absolutely positioned so wrapped lines align
              under the text rather than under the bullet. A lone point needs
              no marker — there is nothing to separate it from. */}
          <ul className={items.length > 1 ? "space-y-2" : ""}>
            {items.map((t, i) => (
              <li
                key={i}
                className={`leading-relaxed ${items.length > 1 ? "relative pl-4" : ""}`}
              >
                {items.length > 1 && (
                  <span className="absolute left-0 top-[0.5em] size-1.5 rounded-full bg-current opacity-50" />
                )}
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Modal({
  title, onClose, children, wide,
}: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-slate-900/40 backdrop-blur-sm sm:items-start sm:p-4">
      <div className={`card w-full rounded-b-none sm:my-8 sm:rounded-2xl ${wide ? "max-w-4xl" : "max-w-lg"}`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-none sm:p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Radio-style option cards used for the big binary choices in the wizard. */
export function ChoiceGrid<T extends string>({
  value, onChange, options, columns = 2,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string; disabled?: boolean; reason?: string }[];
  columns?: number;
}) {
  return (
    <div className={`grid gap-2.5 sm:gap-3 ${
      columns === 3 ? "grid-cols-1 sm:grid-cols-3"
        : columns === 4 ? "grid-cols-2 lg:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2"
    }`}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            title={opt.reason}
            className={`rounded-xl border p-3.5 text-left transition sm:p-4 ${
              opt.disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : active
                  ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100"
                  : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"
            }`}
          >
            <p className={`text-sm font-semibold ${active ? "text-brand-700" : ""}`}>{opt.label}</p>
            {opt.description && <p className="mt-1 text-xs text-slate-500">{opt.description}</p>}
            {opt.disabled && opt.reason && <p className="mt-1 text-xs text-slate-400">{opt.reason}</p>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Multi-select dropdown. Opens a checkbox list and shows the chosen values as
 * removable chips, so several document types can be picked at once.
 */
export function MultiSelect({
  options, value, onChange, placeholder = "Select…",
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="field flex min-h-10 flex-wrap items-center gap-1.5 text-left"
      >
        {!value.length && <span className="text-slate-400">{placeholder}</span>}
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200"
          >
            {v}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); toggle(v); }}
              className="cursor-pointer text-brand-400 hover:text-brand-700"
            >
              <X size={11} />
            </span>
          </span>
        ))}
        <ChevronDown size={15} className="ml-auto shrink-0 text-slate-400" />
      </button>

      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-md">
          {options.map((opt) => (
            <li key={opt}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={value.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-slate-700">{opt}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The header's account control: an avatar trigger that opens a small card with
 * the signed-in person's identity and a sign-out action. Mirrors the pattern
 * used by the 10MS HQ shell's own header, right down to closing on an outside
 * click rather than needing a dedicated close button.
 */
export function UserMenu({
  name, email, subtitle, onSignOut,
}: { name: string; email: string; subtitle?: string; onSignOut?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const AvatarGlyph = () => (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
      <UserRound size={16} />
    </span>
  );

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open user menu"
        className={`flex max-w-56 items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-slate-100 ${open ? "bg-slate-100" : ""}`}
      >
        <AvatarGlyph />
        <span className="hidden min-w-0 flex-1 leading-tight sm:grid">
          <span className="truncate text-sm font-semibold text-slate-800">{name}</span>
          {subtitle && <span className="truncate text-xs text-slate-400">{subtitle}</span>}
        </span>
        <ChevronsUpDown size={15} className="hidden shrink-0 text-slate-400 sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-md">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <AvatarGlyph />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
              <p className="truncate text-xs text-slate-400">{email}</p>
            </div>
          </div>
          {onSignOut && (
            <>
              <div className="my-1 border-t border-slate-200" />
              <button
                type="button"
                onClick={() => { setOpen(false); onSignOut(); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                <LogOut size={15} /> Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Toggle({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border p-3 ${disabled ? "cursor-not-allowed border-slate-200 bg-slate-50" : "cursor-pointer border-slate-200 bg-white hover:bg-slate-50"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${disabled ? "text-slate-400" : "text-slate-700"}`}>{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
