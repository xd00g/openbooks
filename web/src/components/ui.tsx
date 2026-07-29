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

export interface SortState { key: string; dir: 'asc' | 'desc' }
export type HeadCell = string | { label: string; key?: string };

/** `head` entries can be a plain string (unsortable, unchanged from before) or
 *  `{ label, key }` — pass `sort` + `onSort` to make those clickable with an
 *  asc/desc indicator. Fully backward-compatible: existing string[] callers
 *  are unaffected. */
export function Table({ head, children, sort, onSort }: {
  head: HeadCell[]; children: ReactNode; sort?: SortState | null; onSort?: (key: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const key = typeof h === 'string' ? undefined : h.key;
              const active = sort?.key === key;
              return (
                <th key={key ?? `${label}-${i}`} className="px-4 py-2 font-medium">
                  {key && onSort ? (
                    <button onClick={() => onSort(key)} className={`flex items-center gap-1 hover:text-slate-800 ${active ? 'text-slate-800' : ''}`}>
                      {label}
                      <span className="text-[9px]">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  ) : label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/** Toggle asc -> desc -> unsorted for a click-to-sort table header. */
export function toggleSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">{children}</div>;
}

/** Status banner for the page-level `err` message state. Pages reuse one
 *  string for both errors and success confirmations (by convention, success
 *  messages are prefixed "✓ ") — this renders green for success, red for
 *  everything else, instead of always-red regardless of outcome. */
export function Banner({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.trim().startsWith('✓');
  return (
    <div className={`mb-4 rounded-md px-3 py-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
      {text}
    </div>
  );
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
