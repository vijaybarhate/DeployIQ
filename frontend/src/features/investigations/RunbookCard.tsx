import type { RunbookReference } from '../../types/api';
import { normalizeHttpUrl } from '../../lib/urls';

interface Props {
  runbook: RunbookReference;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  panelId?: string;
}

/** Runbook reference card: metadata + validated source links. Never fetches.
    Rendered as a panel on the deep-teal report surface. */
export function RunbookCard({ runbook, headingRef, panelId }: Props) {
  // Normalize once so rendered hrefs never carry whitespace padding.
  const validUrls = runbook.source_urls
    .map((u) => normalizeHttpUrl(u))
    .filter((u): u is string => u !== null);
  const hasInvalid = validUrls.length < runbook.source_urls.length;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4" {...(panelId ? { id: panelId } : {})}>
      <p className="font-mono text-xs text-lavender">{runbook.runbook_id}</p>
      <h4
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 text-sm font-semibold text-canvas outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
      >
        {runbook.title}
      </h4>
      <p className="mt-1 text-xs text-canvas/60">
        BM25 relevance score: {runbook.relevance_score.toFixed(2)} (retrieval ranking, not a
        probability)
      </p>
      {runbook.matched_sections.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/60">Matched sections</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {runbook.matched_sections.map((s) => (
              <li key={s} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-canvas">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/60">Sources</p>
        {runbook.source_urls.length === 0 ? (
          <p className="mt-1 text-xs text-canvas/50">No sources recorded for this runbook.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {validUrls.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-lavender underline decoration-white/30 underline-offset-4 hover:decoration-lavender"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
        {hasInvalid && (
          <p className="mt-1 text-xs text-[#FFCF8C]">
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
      className="ml-1 rounded-full border border-dashed border-white/30 px-2 py-0.5 font-mono text-xs text-canvas/60"
      title={`${kind} ${id} is not present in this investigation's snapshot`}
    >
      {kind === 'Evidence' ? 'Evidence' : 'Runbook'} unavailable: {id}
    </span>
  );
}
