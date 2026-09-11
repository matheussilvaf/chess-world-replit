/**
 * Primitivos compartilhados das páginas de administração (campos numéricos,
 * seções, linhas e caixas de SQL). Mantidos aqui para as páginas de config
 * (energia/skills, Big Chessboard) terem a mesma cara.
 */
import { useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';

export const inputClass =
  'rounded-md border border-slate-700/70 bg-slate-950/70 px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500/60 focus:outline-none disabled:opacity-40';
export const buttonClass =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** Campo numérico com digitação livre: só números válidos no range viram valor. */
export function NumberField({
  value,
  onChange,
  range,
  step = 1,
  disabled,
  className = 'w-20',
  suffix,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  range: { min: number; max: number };
  step?: number;
  disabled?: boolean;
  className?: string;
  suffix?: string;
  label?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const shown = raw ?? String(value);
  const invalid = raw !== null && (raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < range.min || Number(raw) > range.max);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={range.min}
        max={range.max}
        step={step}
        value={shown}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const n = Number(next);
          if (next.trim() !== '' && Number.isFinite(n) && n >= range.min && n <= range.max) onChange(step === 1 ? Math.round(n) : n);
        }}
        onBlur={() => setRaw(null)}
        className={`${inputClass} ${className} text-center ${invalid ? 'border-rose-500/60' : ''}`}
      />
      {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
    </span>
  );
}

export function Section({ title, subtitle, icon, children }: { title: ReactNode; subtitle?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
      <div className="mb-4 flex items-center gap-3">
        {icon}
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-3">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-slate-400">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

export function Row({ label, detail, children }: { label: ReactNode; detail?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800/60 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-200">{label}</div>
        {detail && <div className="truncate font-mono text-[10px] text-slate-500">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function SqlBox({ sql, className = '' }: { sql: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <pre className="overflow-x-auto rounded-md border border-amber-500/20 bg-slate-950/70 p-2.5 pr-10 text-[10px] leading-relaxed text-amber-100/90">{sql}</pre>
      <button
        type="button"
        title="Copiar SQL"
        onClick={() => void navigator.clipboard.writeText(sql)}
        className="absolute right-1.5 top-1.5 rounded-md bg-slate-800/90 p-1.5 text-slate-300 hover:bg-slate-700"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SqlBanner({ text, sql }: { text: string; sql: string | null }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
      <p className="mb-1.5 font-medium">{text}</p>
      {sql && <SqlBox sql={sql} />}
    </div>
  );
}
