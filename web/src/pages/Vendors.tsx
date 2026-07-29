import EntityManager from '../components/EntityManager';
import { formatPhone } from '../lib/format';

export default function Vendors() {
  return (
    <EntityManager config={{
      title: 'Vendors',
      endpoint: '/expenses/vendors',
      queryKey: 'vendors',
      newLabel: 'New vendor',
      columns: [
        { key: 'displayName', label: 'Name' },
        { key: 'companyName', label: 'Company' },
        { key: 'contactName', label: 'Contact' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', render: (r) => formatPhone(r.phone) },
        { key: 'is1099', label: '1099', render: (r) => (r.is1099 ? 'Yes' : '') },
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
        { key: 'taxId', label: 'Tax ID (encrypted)', writeOnly: true },
        { key: 'is1099', label: 'Track for 1099', type: 'checkbox' },
      ],
      addressKey: 'address',
      addressLabel: 'Address',
    }} />
  );
}
