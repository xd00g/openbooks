import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Landmark, ReceiptText, CreditCard, BookOpen,
  Users, BarChart3, Building2, ShieldCheck, ChevronDown, ChevronRight, LogOut, Plus, Package, Percent, CalendarClock, Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { applyTheme } from './lib/theme';
import { useAuth } from './lib/auth';
import Login from './components/Login';
import CreateCompanyDialog from './components/CreateCompanyDialog';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Accounting from './pages/Accounting';
import Sales from './pages/Sales';
import Expenses from './pages/Expenses';
import Payroll from './pages/Payroll';
import Banking from './pages/Banking';
import Company from './pages/Company';
import Admin from './pages/Admin';
import Customers from './pages/Customers';
import Vendors from './pages/Vendors';
import Employees from './pages/Employees';
import Items from './pages/Items';
import TaxRates from './pages/TaxRates';
import PaymentTerms from './pages/PaymentTerms';
import Registers from './pages/Registers';

type NavLeaf = { to: string; label: string; icon?: ReactNode };
type NavGroup = { label: string; icon: ReactNode; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;
const isGroup = (i: NavItem): i is NavGroup => 'children' in i;

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  {
    label: 'Banking', icon: <Landmark size={18} />, children: [
      { to: '/banking', label: 'Integrations & Import', icon: <Landmark size={15} /> },
      { to: '/registers', label: 'Accounts', icon: <Wallet size={15} /> },
    ],
  },
  {
    label: 'Accounting', icon: <BookOpen size={18} />, children: [
      { to: '/accounting', label: 'Chart of Accounts', icon: <BookOpen size={15} /> },
      { to: '/sales', label: 'Sales & Invoices', icon: <ReceiptText size={15} /> },
      { to: '/expenses', label: 'Bills', icon: <CreditCard size={15} /> },
      { to: '/customers', label: 'Customers', icon: <Users size={15} /> },
      { to: '/vendors', label: 'Vendors', icon: <Building2 size={15} /> },
      { to: '/items', label: 'Products & Services', icon: <Package size={15} /> },
      { to: '/tax', label: 'Sales Tax', icon: <Percent size={15} /> },
      { to: '/payment-terms', label: 'Payment Terms', icon: <CalendarClock size={15} /> },
    ],
  },
  {
    label: 'Employees & Payroll', icon: <Users size={18} />, children: [
      { to: '/payroll', label: 'Payroll' },
      { to: '/employees', label: 'Employee Management' },
    ],
  },
  { to: '/reports', label: 'Reports', icon: <BarChart3 size={18} /> },
  { to: '/company', label: 'Company', icon: <Building2 size={18} /> },
  { to: '/admin', label: 'Admin', icon: <ShieldCheck size={18} /> },
];

function CompanySwitcher() {
  const { me, companyId, setCompany } = useAuth();
  const [creating, setCreating] = useState(false);
  const memberships = me?.memberships ?? [];
  return (
    <div className="mx-3 mb-3">
      <div className="flex items-center rounded-md bg-white/10 px-2 text-[color:var(--ob-sidebar-text,#e2e8f0)] ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/20 focus-within:ring-2 focus-within:ring-[color:var(--ob-accent,#6366f1)]">
        <select
          value={companyId ?? ''}
          onChange={(e) => setCompany(e.target.value)}
          className="w-full cursor-pointer bg-transparent py-2 text-sm font-medium focus:outline-none"
        >
          {memberships.map((m) => (
            <option key={m.companyId} value={m.companyId} className="text-slate-900">
              {m.company}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="opacity-70" />
      </div>
      <button
        onClick={() => setCreating(true)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[color:var(--ob-sidebar-text,#e2e8f0)] opacity-75 transition-colors hover:bg-white/10 hover:opacity-100"
      >
        <Plus size={14} /> New company
      </button>
      {creating && <CreateCompanyDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function FirstRun() {
  const { me, logout } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <Building2 className="mb-4 text-slate-400" size={40} />
      <h1 className="text-2xl font-semibold text-slate-800">Welcome to OpenBooks</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        You're signed in as {me?.user.email}, but you don't have a company yet.
        Create one to start keeping its books.
      </p>
      {/* Dialog is rendered inline and always open in first-run mode. */}
      <CreateCompanyDialog firstRun onClose={() => { /* stays open until a company exists */ }} />
      <button onClick={logout} className="mt-6 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700">
        <LogOut size={14} /> Sign out
      </button>
    </div>
  );
}

function useBranding() {
  const { companyId } = useAuth();
  const company = useQuery({
    queryKey: ['company', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/company'),
  });
  const logo = useQuery({
    queryKey: ['company-logo', companyId],
    enabled: !!companyId,
    queryFn: () => api.get('/company/logo-url'),
  });
  useEffect(() => {
    applyTheme(company.data?.theme);
  }, [company.data]);
  return { logoUrl: (logo.data?.url as string) ?? null };
}

function NavLeafLink({ item, nested }: { item: NavLeaf; nested?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md py-2 text-sm text-[color:var(--ob-sidebar-text,#e2e8f0)] transition-colors hover:bg-white/10 ${nested ? 'pl-9 pr-3 text-[13px]' : 'px-3'} ${isActive ? 'bg-white/15 font-medium opacity-100' : 'opacity-75 hover:opacity-100'}`
      }
    >
      {item.icon}
      {item.label}
    </NavLink>
  );
}

function NavGroupItem({ group }: { group: NavGroup }) {
  const loc = useLocation();
  const childActive = group.children.some((c) => loc.pathname === c.to);
  const [open, setOpen] = useState(childActive);
  useEffect(() => { if (childActive) setOpen(true); }, [childActive]);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[color:var(--ob-sidebar-text,#e2e8f0)] transition-colors hover:bg-white/10 ${childActive ? 'opacity-100' : 'opacity-75 hover:opacity-100'}`}
      >
        {group.icon}
        <span className="flex-1 text-left">{group.label}</span>
        {open ? <ChevronDown size={15} className="opacity-70" /> : <ChevronRight size={15} className="opacity-70" />}
      </button>
      {open && <div className="mt-1 space-y-1">{group.children.map((c) => <NavLeafLink key={c.to} item={c} nested />)}</div>}
    </div>
  );
}

function Sidebar() {
  const { me, logout } = useAuth();
  const { logoUrl } = useBranding();
  return (
    <aside
      className="flex w-64 shrink-0 flex-col text-[color:var(--ob-sidebar-text,#e2e8f0)]"
      style={{ backgroundColor: 'var(--ob-sidebar-bg, #0f172a)' }}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        {logoUrl && <img src={logoUrl} alt="Logo" className="h-8 w-8 rounded object-contain" />}
        <span className="text-lg font-semibold tracking-tight">OpenBooks</span>
      </div>
      <CompanySwitcher />
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {NAV.map((item) => (isGroup(item)
          ? <NavGroupItem key={item.label} group={item} />
          : <NavLeafLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3 text-[color:var(--ob-sidebar-text,#e2e8f0)]">
        <div className="truncate text-xs opacity-60">{me?.user.email}</div>
        <button onClick={logout} className="mt-1 flex items-center gap-1 text-xs opacity-75 hover:opacity-100">
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
  if ((me.memberships ?? []).length === 0) return <FirstRun />;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50 p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/banking" element={<Banking />} />
          <Route path="/registers" element={<Registers />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/items" element={<Items />} />
          <Route path="/tax" element={<TaxRates />} />
          <Route path="/payment-terms" element={<PaymentTerms />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/company" element={<Company />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  );
}
