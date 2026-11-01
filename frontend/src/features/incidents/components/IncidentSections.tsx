import type { Incident } from '../../../types/api';

export function IncidentHeader({ incident }: { incident: Incident }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{incident.title}</h1>
      <p className="mt-1 text-sm text-slate-400">
        {incident.project_id} · {incident.source} · {incident.status} · severity{' '}
        {incident.severity ?? 'unclassified'} · observations {incident.observation_count} · matched
        lines {incident.matched_line_count}
      </p>
      <p className="mt-1 break-words font-mono text-xs text-slate-500">
        {incident.id} · first seen {incident.first_seen} · last seen {incident.last_seen}
      </p>
      <p className="mt-1 break-words font-mono text-xs text-slate-500">signature: {incident.error_signature}</p>
    </div>
  );
}

export function IncidentEvidence({ incident }: { incident: Incident }) {
  return (
    <section aria-label="Incident evidence" className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium text-slate-200">Incident evidence</h2>
      <p className="mt-1 text-xs text-slate-500">
        Original evidence from incident collection (no investigation IDs attached).
      </p>
      {incident.evidence.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No structured evidence recorded.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {incident.evidence.map((e, idx) => (
            <li key={`${e.kind}-${idx}`} className="rounded border border-slate-800 p-2 text-sm">
              <p className="font-mono text-xs text-sky-300">{e.kind}</p>
              <p className="mt-1 text-slate-200">{e.summary}</p>
              {e.detail && <p className="mt-1 text-xs text-slate-400">{e.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RawLogs({ logs }: { logs: string }) {
  return (
    <section aria-label="Raw logs" className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium text-slate-200">Raw logs</h2>
      {logs ? (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-xs text-slate-300">
          {logs}
        </pre>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No raw logs captured.</p>
      )}
    </section>
  );
}
