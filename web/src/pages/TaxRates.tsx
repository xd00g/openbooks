import EntityManager from '../components/EntityManager';

export default function TaxRates() {
  return (
    <EntityManager config={{
      title: 'Sales Tax Rates',
      endpoint: '/tax/rates',
      queryKey: 'tax-rates',
      newLabel: 'New tax rate',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'agency', label: 'Agency', render: (r) => r.agency?.name ?? '—' },
        { key: 'rate', label: 'Rate', render: (r) => `${(Number(r.rate) * 100).toFixed(3).replace(/\.?0+$/, '')}%`, sortValue: (r: any) => Number(r.rate) },
      ],
      fields: [
        { key: 'name', label: 'Name * (e.g. "OH Sales Tax")' },
        { key: 'ratePercent', label: 'Rate % (e.g. 7.5)', fromRow: (r) => String(Number(r.rate) * 100) },
        { key: 'agencyName', label: 'Tax agency (e.g. "State of Ohio")' },
      ],
    }} />
  );
}
