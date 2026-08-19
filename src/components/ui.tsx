/** Small shared presentational pieces used across every screen — built on @tenminuteschool/design-system. */

import * as React from 'react';
import { AlertTriangle, Info, Loader2, Search, X } from 'lucide-react';
import {
  Badge,
  Card as DsCard,
  CardContent,
  CardHeader,
  CustomAlert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  LoadingSpinner,
  Progress,
  Switch,
} from '@tenminuteschool/design-system';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PROGRESS, type Status } from '@/shared/types';

export function Money({
  value,
  currency = 'BDT',
}: {
  value: number;
  currency?: string;
}) {
  return (
    <span className="tabular-nums">
      {currency}{' '}
      {Number(value || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The one search box used everywhere. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  busy,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        className="pl-9 pr-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {busy && (
        <Loader2
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  actions,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <DsCard className={className}>
      {(title || actions) && (
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b">
          <div>
            {title && <h2 className="text-sm font-bold">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </DsCard>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  draft: 'bg-muted text-muted-foreground',
  manager_review:
    'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  admin_review:
    'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  finance_review: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  payment_processing:
    'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  payment_disputed:
    'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  completed:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  returned:
    'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-transparent font-semibold',
        STATUS_STYLE[status] || STATUS_STYLE.draft,
      )}
    >
      {STATUS_LABEL[status] || status}
    </Badge>
  );
}

export function ProgressBar({ status }: { status: Status }) {
  const pct = STATUS_PROGRESS[status] ?? 0;
  const tone =
    status === 'rejected'
      ? 'bg-rose-500'
      : status === 'returned'
        ? 'bg-orange-400'
        : 'bg-primary';
  return (
    <div className="flex items-center gap-3">
      <Progress value={pct} className="h-2 flex-1" indicatorClassName={tone} />
      <span className="w-10 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  items,
}: {
  tone?: 'info' | 'warn' | 'error';
  title?: string;
  items: string[];
}) {
  if (!items.length) return null;
  const variant =
    tone === 'warn' ? 'warning' : tone === 'error' ? 'error' : 'info';
  return (
    <CustomAlert variant={variant} title={title} iconPosition="left">
      {/* Several points ran together as one paragraph without a marker: each
          wrapped onto the next line and nothing showed where one ended. */}
      <ul className={items.length > 1 ? 'space-y-2' : ''}>
        {items.map((t, i) => (
          <li
            key={i}
            className={cn(
              'leading-relaxed',
              items.length > 1 && 'relative pl-4',
            )}
          >
            {items.length > 1 && (
              <span className="absolute left-0 top-[0.5em] size-1.5 rounded-full bg-current opacity-50" />
            )}
            {t}
          </li>
        ))}
      </ul>
    </CustomAlert>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <LoadingSpinner size="sm" message={label} />
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          'max-h-[85vh] overflow-y-auto',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Radio-style option cards used for the big binary choices in the wizard. */
export function ChoiceGrid<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    description?: string;
    disabled?: boolean;
    reason?: string;
  }[];
  columns?: number;
}) {
  return (
    <div
      className={cn(
        'grid gap-2.5 sm:gap-3',
        columns === 3
          ? 'grid-cols-1 sm:grid-cols-3'
          : columns === 4
            ? 'grid-cols-2 lg:grid-cols-4'
            : 'grid-cols-1 sm:grid-cols-2',
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            title={opt.reason}
            className={cn(
              'rounded-xl border p-3.5 text-left transition sm:p-4',
              opt.disabled
                ? 'cursor-not-allowed border-border bg-muted text-muted-foreground'
                : active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
            )}
          >
            <p
              className={cn('text-sm font-semibold', active && 'text-primary')}
            >
              {opt.label}
            </p>
            {opt.description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {opt.description}
              </p>
            )}
            {opt.disabled && opt.reason && (
              <p className="mt-1 text-xs text-muted-foreground">{opt.reason}</p>
            )}
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
  options,
  value,
  onChange,
  placeholder = 'Select…',
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
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (opt: string) =>
    onChange(
      value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt],
    );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-xs"
      >
        {!value.length && (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20"
          >
            {v}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                toggle(v);
              }}
              className="cursor-pointer text-primary/60 hover:text-primary"
            >
              <X size={11} />
            </span>
          </span>
        ))}
      </button>

      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover py-1 shadow-md">
          {options.map((opt) => (
            <li key={opt}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={value.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="size-4 rounded border-input text-primary focus:ring-ring"
                />
                <span>{opt}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3',
        disabled
          ? 'cursor-not-allowed border-border bg-muted'
          : 'cursor-pointer border-border bg-card hover:bg-accent',
      )}
    >
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-medium',
            disabled ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/** Icons re-exported so Notice-adjacent, hand-rolled banners elsewhere don't duplicate the import. */
export { AlertTriangle, Info };
