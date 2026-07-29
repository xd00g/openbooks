import type { ReactNode } from 'react';

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
        <div className="flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'neg' ? 'text-red-600' : tone === 'pos' ? 'text-emerald-600' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost'; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  const cls = variant === 'primary'
    ? 'text-[color:var(--ob-accent-text,#fff)] hover:opacity-90'
    : 'border border-slate-300 text-slate-700 hover:bg-slate-50';
  const style = variant === 'primary' ? { backgroundColor: 'var(--ob-accent, #0f172a)' } : undefined;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={style} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">{children}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
