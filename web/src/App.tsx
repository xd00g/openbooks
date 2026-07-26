import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard, Landmark, ReceiptText, CreditCard, BookOpen,
  Users, BarChart3, Building2, ShieldCheck, ChevronDown, LogOut,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import Login from './components/Login';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Accounting from './pages/Accounting';
import Sales from './pages/Sales';
import Expenses from './pages/Expenses';
import Payroll from './pages/Payroll';
import Simple from './pages/Simple';

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { to: '/banking', label: 'Banking', icon: <Landmark size={18} /> },
  { to: '/sales', label: 'Sales', icon: <ReceiptText size={18} /> },
  { to: '/expenses', label: 'Expenses', icon: <CreditCard size={18} /> },
  { to: '/accounting', label: 'Accounting', icon: <BookOpen size={18} /> },
  { to: '/payroll', label: 'Employees & Payroll', icon: <Users size={18} /> },
  { to: '/reports', label: 'Reports', icon: <BarChart3 size={18} /> },
  { to: '/company', label: 'Company', icon: <Building2 size={18} /> },
  { to: '/admin', label: 'Admin', icon: <ShieldCheck size={18} /> },
];

function CompanySwitcher() {
  const { me, companyId, setCompany } = useAuth();
  const memberships = me?.memberships ?? [];
  if (memberships.length === 0) {
    return <div className="mx-3 mb-3 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-400">No company</div>;
  }
  return (
    <div className="mx-3 mb-3 flex items-center rounded-md bg-slate-800 px-2">
      <select
        value={companyId ?? ''}
        onChange={(e) => setCompany(e.target.value)}
        className="w-full bg-transparent py-2 text-sm text-slate-100 focus:outline-none"
      >
        {memberships.map((m) => (
          <option key={m.companyId} value={m.companyId} className="text-slate-900">
            {m.company}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="text-slate-400" />
    </div>
  );
}

function Sidebar() {
  const { me, logout } = useAuth();
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-slate-900 text-slate-100">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">OpenBooks</div>
      <CompanySwitcher />
      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 px-4 py-3">
        <div className="truncate text-xs text-slate-400">{me?.user.email}</div>
        <button onClick={logout} className="mt-1 flex items-center gap-1 text-xs text-slate-300 hover:text-white">
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { loading, me } = useAuth();

  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-400">Loading…</div>;
  }
  if (!me) return <Login />;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50 p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/banking" element={<Simple title="Banking" note="Bank feeds import + reconciliation live in the API (POST /banking/…). A UI for statement matching is the next banking screen." />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/company" element={<Simple title="Company" note="Company profile & settings (EIN, address, invoice branding, fiscal year, sales tax) will live here." />} />
          <Route path="/admin" element={<Simple title="Admin" note="Users, roles/permissions, integrations, and the audit log will live here." />} />
        </Routes>
      </main>
    </div>
  );
}
