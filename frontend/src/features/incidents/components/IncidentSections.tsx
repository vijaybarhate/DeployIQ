import { formatDateTime } from '../../../lib/time';
import type { Incident } from '../../../types/api';

export function IncidentHeader({ incident }: { incident: Incident }) {
  return (
    <div data-tour="details-header">
      <h1 className="font-display text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
        {incident.title}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {incident.project_id} · {incident.source} · {incident.status} · severity{' '}
        {incident.severity ?? 'unclassified'} · observations {incident.observation_count} · matched
        lines {incident.matched_line_count}
      </p>
      <p className="mt-2 break-words font-mono text-xs text-slate-500">
        {incident.id} · first seen {formatDateTime(incident.first_seen)} · last seen{' '}
        {formatDateTime(incident.last_seen)}
      </p>
      <p className="mt-1 break-words font-mono text-xs text-slate-500">signature: {incident.error_signature}</p>
      <p className="mt-1 text-xs text-slate-500">
        Repeat crashes with this signature are grouped here; observations counts sightings.
      </p>
    </div>
  );
}

export function IncidentEvidence({ incident }: { incident: Incident }) {
  return (
    <section
      aria-label="Incident evidence"
      data-tour="details-evidence"
      className="rounded-[40px] bg-teal p-6 text-canvas sm:p-8"
    >
      <h2 className="text-sm font-semibold text-canvas">Incident evidence</h2>
      <p className="mt-1 text-xs text-canvas/60">
        Original evidence from incident collection (no investigation IDs attached).
      </p>
      {incident.evidence.length === 0 ? (
        <p className="mt-3 text-sm text-canvas/70">No structured evidence recorded.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {incident.evidence.map((e, idx) => (
            <li key={`${e.kind}-${idx}`} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <p className="font-mono text-xs text-lavender">{e.kind}</p>
              <p className="mt-1 text-canvas">{e.summary}</p>
              {e.detail && <p className="mt-1 text-xs text-canvas/65">{e.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RawLogs({ logs }: { logs: string }) {
  return (
    <section
      aria-label="Raw logs"
      data-tour="details-logs"
      className="rounded-[40px] bg-teal p-6 text-canvas sm:p-8"
    >
      <h2 className="text-sm font-semibold text-canvas">Raw logs</h2>
      <p className="mt-1 text-xs text-canvas/60">
        Exact lines captured from the container when this was detected — frozen evidence, not a
        live tail. New sightings raise the observation count above.
      </p>
      {logs ? (
        <pre className="terminal-scroll mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white/5 p-4 font-mono text-xs text-canvas/85">
          {logs}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-canvas/70">No raw logs captured.</p>
      )}
    </section>
  );
}
