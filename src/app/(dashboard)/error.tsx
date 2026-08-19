'use client';

import { useEffect } from 'react';
import { Button } from '@tenminuteschool/design-system';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error occurred while loading this page.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
