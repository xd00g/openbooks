import EntityManager from '../components/EntityManager';

export default function Customers() {
  return (
    <EntityManager config={{
      title: 'Customers',
      endpoint: '/sales/customers',
      queryKey: 'customers',
      newLabel: 'New customer',
      columns: [
        { key: 'displayName', label: 'Name' },
        { key: 'companyName', label: 'Company' },
        { key: 'contactName', label: 'Contact' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
      ],
      fields: [
        { key: 'displayName', label: 'Display name *' },
        { key: 'companyName', label: 'Company' },
        { key: 'contactName', label: 'Contact person' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'mobile', label: 'Mobile' },
        { key: 'fax', label: 'Fax' },
        { key: 'website', label: 'Website' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      addressKey: 'billingAddress',
      addressLabel: 'Billing address',
    }} />
  );
}
