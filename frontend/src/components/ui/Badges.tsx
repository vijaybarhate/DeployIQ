/* Wispr-language status pills: full-radius chips, Figtree label style,
   light tint backgrounds with dark ink text. open = lavender, in-progress
   & resolved = teal family, critical = muted red. */

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-900 text-red-200',
  high: 'bg-orange-900 text-orange-200',
  medium: 'bg-amber-900 text-amber-200',
  low: 'bg-slate-800 text-slate-200',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-900 text-blue-200',
  investigating: 'bg-violet-900 text-violet-200',
  resolved: 'bg-emerald-900 text-emerald-200',
};

const FALLBACK = 'bg-slate-800 text-slate-200';

const pill =
  'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] leading-none';

export function SeverityBadge({ value }: { value: string | null }) {
  if (!value) return <span className={`${pill} ${FALLBACK}`}>unclassified</span>;
  const key = value.toLowerCase();
  return <span className={`${pill} ${SEVERITY_STYLES[key] ?? FALLBACK}`}>{value}</span>;
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`${pill} ${STATUS_STYLES[value] ?? FALLBACK}`}>{value}</span>;
}

export function SourceBadge({ value }: { value: string }) {
  const label = value === 'github_actions' ? 'GitHub Actions' : value === 'docker' ? 'Docker' : value;
  return (
    <span className={`${pill} bg-[rgba(240,215,255,0.55)] text-plum`}>{label}</span>
  );
}
