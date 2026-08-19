import { RequestList } from '@/features/requests/request-list';

export default function DeskPendingPage() {
  return (
    <RequestList
      scope="pending"
      showFilters
      title="Pending Approvals"
      subtitle="Other people's requests waiting on your decision right now."
    />
  );
}
