import type { RunbookReference } from '../../types/api';
import { normalizeHttpUrl } from '../../lib/urls';

interface Props {
  runbook: RunbookReference;
}

/** Runbook reference card: metadata + validated source links. Never fetches. */
export function RunbookCard({ runbook }: Props) {
  // Normalize once so rendered hrefs never carry whitespace padding.
  const validUrls = runbook.source_urls
    .map((u) => normalizeHttpUrl(u))
    .filter((u): u is string => u !== null);
  const hasInvalid = validUrls.length < runbook.source_urls.length;

  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-3">
      <p className="font-mono text-xs text-sky-300">{runbook.runbook_id}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{runbook.title}</p>
      <p className="mt-1 text-xs text-slate-400">
        BM25 relevance score: {runbook.relevance_score.toFixed(2)} (retrieval ranking, not a
        probability)
      </p>
      {runbook.matched_sections.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Matched sections</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {runbook.matched_sections.map((s) => (
              <li key={s} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Sources</p>
        {runbook.source_urls.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No sources recorded for this runbook.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {validUrls.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-sky-400 hover:underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
        {hasInvalid && (
          <p className="mt-1 text-xs text-amber-300">
            Some source references are unavailable (omitted unsafe or malformed URLs).
          </p>
        )}
      </div>
    </div>
  );
}

/** Inline unavailable-reference note for IDs missing from the investigation snapshot. */
export function MissingReferenceNote({ kind, id }: { kind: 'Evidence' | 'Runbook'; id: string }) {
  return (
    <span
      role="note"
      className="ml-1 rounded border border-dashed border-slate-600 px-1.5 py-0.5 font-mono text-xs text-slate-400"
      title={`${kind} ${id} is not present in this investigation's snapshot`}
    >
      {kind === 'Evidence' ? 'Evidence' : 'Runbook'} unavailable: {id}
    </span>
  );
}
