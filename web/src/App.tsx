import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard,
  Landmark,
  ReceiptText,
  CreditCard,
  BookOpen,
  Users,
  BarChart3,
  Building2,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** Left-nav modules — mirror docs/DESIGN.md §6. */
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

function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">
        OpenBooks
      </div>

      {/* Company switcher (stub) */}
      <button className="mx-3 mb-3 flex items-center justify-between rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
        <span className="truncate">Acme LLC</span>
        <ChevronDown size={16} />
      </button>

      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 text-xs text-slate-500">v0.0.1 · pre-alpha</div>
    </aside>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
      <p className="mt-2 text-slate-500">
        This module is scaffolded but not yet implemented. See{' '}
        <code className="rounded bg-slate-100 px-1">docs/DESIGN.md</code> for the plan.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50 p-8">
        <Routes>
          <Route path="/" element={<Placeholder title="Dashboard" />} />
          <Route path="/banking" element={<Placeholder title="Banking" />} />
          <Route path="/sales" element={<Placeholder title="Sales" />} />
          <Route path="/expenses" element={<Placeholder title="Expenses" />} />
          <Route path="/accounting" element={<Placeholder title="Accounting" />} />
          <Route path="/payroll" element={<Placeholder title="Employees & Payroll" />} />
          <Route path="/reports" element={<Placeholder title="Reports" />} />
          <Route path="/company" element={<Placeholder title="Company" />} />
          <Route path="/admin" element={<Placeholder title="Admin" />} />
          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
      </main>
    </div>
  );
}
