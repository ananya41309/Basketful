import { STATUS_COPY } from '../lib/format.js';

// Full class names only: Tailwind can't see classes built from string fragments.
const TONES = {
  stone: 'bg-stone-100 text-stone-700 ring-stone-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};

export function Badge({ tone = 'stone', children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const copy = STATUS_COPY[status] ?? { label: status, tone: 'stone' };
  return <Badge tone={copy.tone}>{copy.label}</Badge>;
}

export function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className = '', busy, disabled, children, ...props }) {
  const styles = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-stone-300',
    secondary: 'bg-white text-stone-800 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:text-stone-400',
    danger: 'bg-white text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:text-stone-400',
    ghost: 'text-stone-600 hover:bg-stone-100',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">{error}</p>;
}

export function Row({ label, value, strong, muted, hint }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${muted ? 'text-stone-500' : 'text-stone-700'}`}>
      <span>
        {label}
        {hint && <span className="ml-1 text-xs text-stone-400">{hint}</span>}
      </span>
      <span className={`tabular ${strong ? 'font-semibold text-stone-900' : ''}`}>{value}</span>
    </div>
  );
}
