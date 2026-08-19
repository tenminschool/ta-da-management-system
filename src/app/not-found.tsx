import Link from 'next/link';
import { Button } from '@tenminuteschool/design-system';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist or was moved.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard">Go to Dashboard</Link>
      </Button>
    </div>
  );
}
