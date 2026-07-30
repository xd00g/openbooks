import type { ReactNode } from 'react';

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-8 flex items-end justify-between border-b border-rule pb-4">
        <h1 className="font-display text-title font-semibold uppercase text-ink">{title}</h1>
        <div className="flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** Section eyebrow — the recurring structural device. Small, tracked-out,
 *  uppercase, sitting on a hairline. Used for card titles and column groups. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="font-display text-eyebrow font-semibold uppercase text-muted">{children}</div>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="border border-rule bg-white p-5">
      {title && (
        <div className="mb-4 border-b border-rule pb-2">
          <Eyebrow>{title}</Eyebrow>
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const toneCls = tone === 'neg' ? 'text-owed' : tone === 'pos' ? 'text-balance' : 'text-ink';
  return (
    <div className="border border-rule bg-white p-5">
      <Eyebrow>{label}</Eyebrow>
      <div className={`tnum mt-3 font-display text-figure font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

/** The balance seam — this app's signature element.
 *
 *  Double-entry exists to balance, so the dashboard states that fact as a
 *  single rule split proportionally between total debits and total credits.
 *  Balanced books put the seam dead center; a discrepancy visibly slides it
 *  off-center and turns it oxblood. It reads at a glance from across a room,
 *  which is the one thing a bookkeeper actually wants to know.
 */
export function BalanceSeam({ debits, credits }: { debits: number; credits: number }) {
  const total = Math.abs(debits) + Math.abs(credits);
  const pct = total === 0 ? 50 : (Math.abs(debits) / total) * 100;
  const balanced = Math.abs(Math.abs(debits) - Math.abs(credits)) < 0.005;
  return (
    <div>
      <div className="flex items-end justify-between">
        <Eyebrow>Debits</Eyebrow>
        <span className={`font-display text-eyebrow font-semibold uppercase ${balanced ? 'text-balance' : 'text-owed'}`}>
          {balanced ? 'In balance' : 'Out of balance'}
        </span>
        <Eyebrow>Credits</Eyebrow>
      </div>
      <div
        className="relative mt-2 h-[3px] w-full bg-rule"
        role="img"
        aria-label={balanced ? 'Debits and credits are in balance' : 'Debits and credits do not balance'}
      >
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${balanced ? 'bg-ink' : 'bg-owed'}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className={`absolute -top-1 h-[11px] w-px transition-[left] duration-500 ${balanced ? 'bg-ink' : 'bg-owed'}`}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  const base = 'rounded px-3 py-1.5 font-display text-eyebrow font-semibold uppercase transition-colors disabled:opacity-40';
  const cls = variant === 'primary'
    ? 'text-[color:var(--ob-accent-text,#fff)] hover:opacity-85'
    : variant === 'danger'
      ? 'border border-owed text-owed hover:bg-owed hover:text-white'
      : 'border border-rule text-ink hover:bg-ink hover:text-white';
  const style = variant === 'primary' ? { backgroundColor: 'var(--ob-accent, #16171b)' } : undefined;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={style} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

export interface SortState { key: string; dir: 'asc' | 'desc' }
export type HeadCell = string | { label: string; key?: string };

/** `head` entries can be a plain string (unsortable) or `{ label, key }` —
 *  pass `sort` + `onSort` to make those clickable with an asc/desc indicator. */
export function Table({ head, children, sort, onSort }: {
  head: HeadCell[]; children: ReactNode; sort?: SortState | null; onSort?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto border border-rule bg-white">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-rule bg-white text-left">
          <tr>
            {head.map((h, i) => {
              const label = typeof h === 'string' ? h : h.label;
              const key = typeof h === 'string' ? undefined : h.key;
              const active = sort?.key === key;
              return (
                <th key={key ?? `${label}-${i}`} className="px-4 py-2.5 font-display text-eyebrow font-semibold uppercase text-muted">
                  {key && onSort ? (
                    <button onClick={() => onSort(key)} className={`flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}>
                      {label}
                      <span className="text-[9px]">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  ) : label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">{children}</tbody>
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
      className="w-64 rounded border border-rule bg-white px-3 py-1.5 text-sm placeholder:text-muted focus:border-ink focus:outline-none"
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-rule p-10 text-center text-sm text-muted">{children}</div>;
}

/** Status banner for the page-level `err` message state. Pages reuse one
 *  string for both errors and success confirmations (by convention, success
 *  messages are prefixed "✓ ") — this renders it as balanced vs owed. */
export function Banner({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.trim().startsWith('✓');
  return (
    <div
      role="status"
      className={`mb-4 border-l-2 py-2 pl-3 text-sm ${ok ? 'border-balance bg-balance/5 text-balance' : 'border-owed bg-owed/5 text-owed'}`}
    >
      {text}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg border border-rule bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between border-b border-rule pb-3">
          <h2 className="font-display text-base font-semibold uppercase text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
