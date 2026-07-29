import EntityManager from '../components/EntityManager';

export default function PaymentTerms() {
  return (
    <EntityManager config={{
      title: 'Payment Terms',
      endpoint: '/payment-terms',
      queryKey: 'payment-terms',
      newLabel: 'New term',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'dueInDays', label: 'Due (days)' },
        { key: 'discountPercent', label: 'Discount', render: (r) => (r.discountPercent ? `${(Number(r.discountPercent) * 100).toFixed(2)}% / ${r.discountDays ?? 0}d` : '—'), sortValue: (r: any) => Number(r.discountPercent ?? 0) },
      ],
      fields: [
        { key: 'name', label: 'Name * (e.g. "Net 30")' },
        { key: 'dueInDays', label: 'Due in days' },
        { key: 'discountDays', label: 'Discount days (optional)' },
      ],
    }} />
  );
}
