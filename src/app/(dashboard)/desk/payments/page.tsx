import { RequestList } from '@/features/requests/request-list';

export default function DeskPaymentsPage() {
  return (
    <RequestList
      scope="desk_payments"
      selectable
      quickFilters={[
        {
          key: 'finance_review',
          label: 'Pending approval',
          statuses: ['finance_review'],
        },
        {
          key: 'payment_processing',
          label: 'Pending payment',
          statuses: ['payment_processing'],
        },
        { key: 'paid', label: 'Paid', statuses: ['paid', 'completed'] },
      ]}
      title="Payments"
      subtitle="Claims waiting on Finance — to approve, to pay, and already paid."
    />
  );
}
