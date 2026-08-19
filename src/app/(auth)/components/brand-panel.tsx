import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { APP_NAME } from '@/constants';

export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-zinc-950 text-zinc-100 lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-size-[36px_36px] mask-[radial-gradient(ellipse_at_center,black_45%,transparent_85%)]"
      />
      {/* Soft glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-32 h-[420px] w-[420px] rounded-full bg-sky-500/10 blur-3xl"
      />

      {/* Brand mark */}
      <div className="relative z-10 flex items-center gap-2.5">
        <Logo variant="inverse" className="h-9 w-9" iconSize={18} />
        <span className="text-base font-semibold tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Hero copy */}
      <div className="relative z-10 max-w-md space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          <ShieldCheck size={12} />
          Internal access only
        </div>
        <h2 className="text-3xl font-semibold leading-[1.15] tracking-tight md:text-4xl">
          The control center for your operations.
        </h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          Manage your application, monitor activity, and ship faster from one
          focused workspace.
        </p>
      </div>

      {/* Footer meta */}
      <div className="relative z-10 flex items-center justify-between text-xs text-zinc-500">
        <span>© {new Date().getFullYear()} · 10 Minute School</span>
        <span className="font-mono">v1.0.0</span>
      </div>
    </aside>
  );
}
