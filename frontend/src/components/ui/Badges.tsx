const severityStyles: Record<string, string> = {
  critical: 'bg-red-900 text-red-200',
  high: 'bg-orange-900 text-orange-200',
  medium: 'bg-amber-900 text-amber-200',
  low: 'bg-slate-700 text-slate-200',
};

const statusStyles: Record<string, string> = {
  open: 'bg-blue-900 text-blue-200',
  investigating: 'bg-violet-900 text-violet-200',
  resolved: 'bg-emerald-900 text-emerald-200',
};

export function SeverityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">unclassified</span>;
  const key = value.toLowerCase();
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${severityStyles[key] ?? 'bg-slate-700 text-slate-200'}`}>
      {value}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyles[value] ?? 'bg-slate-700 text-slate-200'}`}>
      {value}
    </span>
  );
}

export function SourceBadge({ value }: { value: string }) {
  const label = value === 'github_actions' ? 'GitHub Actions' : value === 'docker' ? 'Docker' : value;
  return (
    <span className="rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200">{label}</span>
  );
}
