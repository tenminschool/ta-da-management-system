import { Skeleton } from '@tenminuteschool/design-system';

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
