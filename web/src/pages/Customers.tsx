import EntityManager from '../components/EntityManager';
import { formatPhone } from '../lib/format';

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
        { key: 'phone', label: 'Phone', render: (r) => formatPhone(r.phone) },
      ],
      fields: [
        { key: 'displayName', label: 'Display name *' },
        { key: 'companyName', label: 'Company' },
        { key: 'contactName', label: 'Contact person' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'mobile', label: 'Mobile', type: 'phone' },
        { key: 'fax', label: 'Fax', type: 'phone' },
        { key: 'website', label: 'Website' },
        { key: 'notes', label: 'Notes', full: true },
      ],
      addressKey: 'billingAddress',
      addressLabel: 'Billing address',
    }} />
  );
}
