import EntityManager from '../components/EntityManager';
import { money } from '../lib/format';

export default function Items() {
  return (
    <EntityManager config={{
      title: 'Products & Services',
      endpoint: '/items',
      queryKey: 'items',
      newLabel: 'New item',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'sku', label: 'SKU' },
        { key: 'type', label: 'Type' },
        { key: 'description', label: 'Description' },
        { key: 'unitPrice', label: 'Price', render: (r) => (r.unitPrice ? money(r.unitPrice) : '—') },
      ],
      fields: [
        { key: 'name', label: 'Name *' },
        { key: 'sku', label: 'SKU' },
        { key: 'type', label: 'Type', type: 'select', options: [
          { value: 'service', label: 'Service' },
          { value: 'product', label: 'Product' },
          { value: 'bundle', label: 'Bundle' },
        ] },
        { key: 'unitPrice', label: 'Unit price' },
        { key: 'incomeAccountId', label: 'Income account (for invoices)', type: 'select', optionsEndpoint: '/accounts', optionFilter: (a: any) => a.type === 'income', optionLabel: (a: any) => `${a.code} · ${a.name}` },
        { key: 'expenseAccountId', label: 'Expense account (for bills)', type: 'select', optionsEndpoint: '/accounts', optionFilter: (a: any) => a.type === 'expense', optionLabel: (a: any) => `${a.code} · ${a.name}` },
        { key: 'description', label: 'Description', full: true },
      ],
    }} />
  );
}
