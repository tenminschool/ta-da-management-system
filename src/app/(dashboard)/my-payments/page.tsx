import { RequestList } from '@/features/requests/request-list';

export default function MyPaymentsPage() {
  return (
    <RequestList
      scope="mine_payments"
      showEmployee={false}
      title="My Payments"
      subtitle="Your claims that reached payment — processing, paid and completed."
    />
  );
}
