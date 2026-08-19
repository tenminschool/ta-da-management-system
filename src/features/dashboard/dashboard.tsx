'use client';

import { useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/use-auth';

const noopSubscribe = () => () => {};
let cachedNow: Date | null = null;
const clientNow = () => (cachedNow ??= new Date());
const serverNow = (): Date | null => null;

function getGreeting(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export function DashboardPage() {
  const { user } = useAuth();
  const now = useSyncExternalStore(noopSubscribe, clientNow, serverNow);
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const greeting = now ? getGreeting(now) : 'Welcome';
  const dateLabel = now ? dateFormatter.format(now) : '';

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        {dateLabel && (
          <p className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground/80">
            {dateLabel}
          </p>
        )}
        <h1 className="text-3xl font-semibold leading-[1.1] sm:text-4xl">
          {greeting},{' '}
          <span className="text-muted-foreground/90">{firstName}.</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Your dashboard is ready. Start building your features here.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border/70 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Add your dashboard content here.
        </p>
      </div>
    </div>
  );
}
