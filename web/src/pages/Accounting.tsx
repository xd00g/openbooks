import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Page, Table, Empty } from '../components/ui';

export default function Accounting() {
  const { companyId } = useAuth();
  const q = useQuery({
    queryKey: ['accounts', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/accounts'),
  });

  if (!companyId) return <Page title="Accounting"><Empty>Select a company.</Empty></Page>;

  return (
    <Page title="Chart of Accounts">
      {q.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {q.data && (
        <Table head={['Code', 'Name', 'Type', 'Subtype', 'System']}>
          {q.data.map((a: any) => (
            <tr key={a.id}>
              <td className="px-4 py-2 text-slate-500">{a.code}</td>
              <td className="px-4 py-2">{a.name}</td>
              <td className="px-4 py-2 capitalize">{a.type}</td>
              <td className="px-4 py-2 text-slate-500">{a.subtype.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2">{a.isSystem ? '•' : ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
}
