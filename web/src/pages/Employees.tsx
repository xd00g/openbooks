import EntityManager from '../components/EntityManager';
import { money, formatPhone } from '../lib/format';

export default function Employees() {
  return (
    <EntityManager config={{
      title: 'Employees',
      endpoint: '/payroll/employees',
      queryKey: 'employees',
      newLabel: 'New employee',
      columns: [
        { key: 'name', label: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', render: (r) => formatPhone(r.phone) },
        { key: 'payType', label: 'Pay type', render: (r) => r.payType ?? 'hourly' },
        { key: 'payRate', label: 'Rate', render: (r) => (r.payRate ? money(r.payRate) : '—') },
      ],
      fields: [
        { key: 'firstName', label: 'First name *' },
        { key: 'lastName', label: 'Last name *' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'payType', label: 'Pay type', type: 'select', options: [{ value: 'hourly', label: 'Hourly' }, { value: 'salary', label: 'Salary (annual)' }] },
        { key: 'payRate', label: 'Pay rate' },
        { key: 'filingStatus', label: 'Filing status' },
        { key: 'hireDate', label: 'Hire date', type: 'date' },
        { key: 'ssn', label: 'SSN (encrypted)', writeOnly: true },
        { key: 'bankAccount', label: 'Bank account (encrypted)', writeOnly: true },
      ],
      addressKey: 'address',
      addressLabel: 'Home address',
    }} />
  );
}
