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
import VendorStatements from './pages/VendorStatements';
import Employees from './pages/Employees';
import Items from './pages/Items';
import TaxRates from './pages/TaxRates';
import PaymentTerms from './pages/PaymentTerms';
import Registers from './pages/Registers';
import Reconcile from './pages/Reconcile';
import Checks from './pages/Checks';

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
      { to: '/reconcile', label: 'Reconcile', icon: <BookOpen size={15} /> },
      { to: '/checks', label: 'Print Checks', icon: <ReceiptText size={15} /> },
    ],
  },
  {
    label: 'Accounting', icon: <BookOpen size={18} />, children: [
      { to: '/accounting', label: 'Chart of Accounts', icon: <BookOpen size={15} /> },
      { to: '/sales', label: 'Sales & Invoices', icon: <ReceiptText size={15} /> },
      { to: '/expenses', label: 'Bills', icon: <CreditCard size={15} /> },
      { to: '/customers', label: 'Customers', icon: <Users size={15} /> },
      { to: '/vendors', label: 'Vendors', icon: <Building2 size={15} /> },
      { to: '/vendor-statements', label: 'Vendor Statements', icon: <ReceiptText size={15} /> },
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
    <div className="mx-3 mb-4">
      <div className="relative rounded border border-white/15 bg-white/5 text-[color:var(--ob-sidebar-text,#e8e7e2)] transition-colors hover:bg-white/10 focus-within:border-white/40">
        <select
          value={companyId ?? ''}
          onChange={(e) => setCompany(e.target.value)}
          aria-label="Active company"
          className="w-full cursor-pointer appearance-none rounded bg-transparent py-2.5 pl-3 pr-8 text-sm font-medium focus:outline-none"
        >
          {memberships.map((m) => (
            <option key={m.companyId} value={m.companyId} className="text-ink">
              {m.company}
            </option>
          ))}
        </select>
        {/* Overlay icon only — pointer-events-none so clicks always land on the <select> beneath it. */}
        <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60" />
      </div>
      <button
        onClick={() => setCreating(true)}
        className="mt-1.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 font-display text-eyebrow font-semibold uppercase text-[color:var(--ob-sidebar-text,#e8e7e2)] opacity-60 transition-opacity hover:bg-white/10 hover:opacity-100"
      >
        <Plus size={13} /> New company
      </button>
      {creating && <CreateCompanyDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function FirstRun() {
  const { me, logout } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center bg-paper px-4 text-center">
      <Building2 className="mb-4 text-muted" size={32} />
      <h1 className="font-display text-title font-semibold uppercase text-ink">Open your first set of books</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        You're signed in as {me?.user.email}. Name a company and OpenBooks will seed
        its chart of accounts.
      </p>
      {/* Dialog is rendered inline and always open in first-run mode. */}
      <CreateCompanyDialog firstRun onClose={() => { /* stays open until a company exists */ }} />
      <button onClick={logout} className="mt-6 flex items-center gap-1 font-display text-eyebrow font-semibold uppercase text-muted hover:text-ink">
        <LogOut size={13} /> Sign out
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
        `relative flex items-center gap-2.5 rounded py-2 text-sm text-[color:var(--ob-sidebar-text,#e8e7e2)] transition-colors hover:bg-white/10 ${nested ? 'pl-9 pr-3 text-[13px]' : 'px-3'} ${isActive ? 'bg-white/10 font-medium opacity-100 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-current' : 'opacity-70 hover:opacity-100'}`
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
        className={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-[color:var(--ob-sidebar-text,#e8e7e2)] transition-colors hover:bg-white/10 ${childActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
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
      <div className="px-4 pb-4 pt-5">
        <div className="flex items-center gap-2">
          {logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 rounded object-contain" />}
          <span className="font-display text-lg font-semibold uppercase tracking-tight">OpenBooks</span>
        </div>
        {/* Wordmark rests on the debit/credit seam — the same device the
            dashboard uses to state whether the books balance. */}
        <div className="mt-2.5 flex h-px w-full">
          <div className="h-px flex-1 bg-white/40" />
          <div className="h-px flex-1 bg-white/10" />
        </div>
      </div>
      <CompanySwitcher />
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {NAV.map((item) => (isGroup(item)
          ? <NavGroupItem key={item.label} group={item} />
          : <NavLeafLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3 text-[color:var(--ob-sidebar-text,#e8e7e2)]">
        <div className="truncate text-xs opacity-50">{me?.user.email}</div>
        <button onClick={logout} className="mt-1 flex items-center gap-1 font-display text-eyebrow font-semibold uppercase opacity-70 hover:opacity-100">
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { loading, me } = useAuth();

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-paper text-sm text-muted">Loading…</div>;
  }
  if (!me) return <Login />;
  if ((me.memberships ?? []).length === 0) return <FirstRun />;

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-paper p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/banking" element={<Banking />} />
          <Route path="/registers" element={<Registers />} />
          <Route path="/reconcile" element={<Reconcile />} />
          <Route path="/checks" element={<Checks />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/vendor-statements" element={<VendorStatements />} />
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
