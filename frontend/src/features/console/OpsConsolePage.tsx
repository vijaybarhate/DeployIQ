import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../../lib/api/client';
import { askCopilot, containerLogs, manualIngest } from '../../lib/api/console';
import { triggerInvestigation } from '../../lib/api/investigations';
import { useContainers, useContainerLogs, useHealth, useModels } from '../../hooks/queries';
import type { CopilotAnswer, Incident } from '../../types/api';

type Tab = 'live' | 'manual' | 'copilot';

const MODEL_KEY = 'deployiq-model';

function loadModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function OpsConsolePage() {
  const [tab, setTab] = useState<Tab>('live');
  const [target, setTarget] = useState('');
  const [attached, setAttached] = useState<string | null>(null);
  const [tail, setTail] = useState(200);
  const [model, setModel] = useState(loadModel);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [madeIncident, setMadeIncident] = useState<Incident | null>(null);

  const [manualProject, setManualProject] = useState('demo');
  const [manualContainer, setManualContainer] = useState('');
  const [manualText, setManualText] = useState('');

  const [copilotQ, setCopilotQ] = useState('');
  const [copilotIncident, setCopilotIncident] = useState('');
  const [copilotOut, setCopilotOut] = useState<CopilotAnswer | null>(null);

  const health = useHealth();
  const containers = useContainers();
  const models = useModels();
  const logs = useContainerLogs(attached, tail);

  useEffect(() => {
    try {
      if (model) localStorage.setItem(MODEL_KEY, model);
      else localStorage.removeItem(MODEL_KEY);
    } catch {
      /* private mode: picker still works for this session */
    }
  }, [model]);

  const dockerConnected = health.data?.docker.connected ?? null;
  const modelOptions = models.data ?? [];
  const effectiveModel = model || models.data?.[0]?.id || '';

  async function attach(name: string) {
    const cleaned = name.trim();
    if (!cleaned) {
      setError('Type a container name first.');
      return;
    }
    setError(null);
    setNotice(null);
    setAttached(cleaned);
    setTab('live');
  }

  async function diagnoseAttached() {
    if (!attached) return;
    setBusy('diagnose');
    setError(null);
    setNotice(null);
    try {
      const tailLogs = await containerLogs(attached, 500);
      const text = tailLogs.lines.join('\n');
      if (!text.trim()) {
        setError('No log lines to diagnose for this container.');
        return;
      }
      const incident = await manualIngest({
        project_id: 'demo',
        raw_logs: text.slice(-20000),
        container_name: attached,
      });
      setMadeIncident(incident);
      setNotice(`Incident ${incident.title} recorded. Open it to run AI investigation.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnose failed');
    } finally {
      setBusy(null);
    }
  }

  async function runInvestigation(incidentId: string) {
    setBusy('investigate');
    setError(null);
    try {
      await triggerInvestigation(incidentId, effectiveModel || undefined);
      setNotice('Investigation started with the selected engine. Open the incident to follow it.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError(`Model rejected: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Investigation failed');
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitManual() {
    setBusy('manual');
    setError(null);
    setNotice(null);
    try {
      const incident = await manualIngest({
        project_id: manualProject.trim() || 'demo',
        raw_logs: manualText,
        container_name: manualContainer.trim() || undefined,
      });
      setMadeIncident(incident);
      setNotice(`Manual incident recorded: ${incident.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manual ingest failed');
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    setBusy('copilot');
    setError(null);
    try {
      const out = await askCopilot({
        question: copilotQ,
        incident_id: copilotIncident.trim() || undefined,
        model: effectiveModel || undefined,
      });
      setCopilotOut(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot failed');
    } finally {
      setBusy(null);
    }
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        tab === id ? 'bg-violet-700 text-white' : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Console header: connection + engine + key note (matches demo photo layout). */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-900 p-3">
        <div className="mr-auto">
          <p className="text-sm font-semibold">DeployIQ · Autonomous SRE Agent</p>
          <p className="text-xs text-slate-400">Ops console — Docker, evidence, AI diagnosis in one place.</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-xs">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${dockerConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
          />
          Docker: {dockerConnected === null ? '…' : dockerConnected ? 'Connected' : 'Down'}
        </span>
        <label className="flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-xs">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Engine:
          <select
            aria-label="AI engine (free models only)"
            value={effectiveModel}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[220px] bg-transparent text-xs text-slate-100 outline-none"
          >
            {modelOptions.length === 0 && <option value="">openrouter/free</option>}
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900">
                {m.name || m.id}
              </option>
            ))}
          </select>
        </label>
        <span
          title="The backend uses the server OPENROUTER_API_KEY. No key is typed or stored in the browser."
          className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300"
        >
          🔑 Server key
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-800 bg-emerald-950/40 p-2 text-sm text-emerald-200">
          {notice}{' '}
          {madeIncident && (
            <Link to={`/incidents/${madeIncident.id}`} className="underline">
              Open incident →
            </Link>
          )}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT column */}
        <section className="space-y-3 rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex gap-1" role="tablist" aria-label="Console input">
            {tabBtn('live', 'Live Docker')}
            {tabBtn('manual', 'Manual Logs')}
            {tabBtn('copilot', 'SRE Copilot')}
          </div>

          {tab === 'live' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="target-container" className="text-xs font-medium text-slate-300">
                  Target Container:
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="target-container"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="e.g. deployiq-demo-crashme-1"
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => attach(target)}
                    className="rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-600"
                  >
                    Attach &amp; Stream
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Read-only tail (auto-refresh every 10s). Nothing is executed inside containers.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-slate-200">Detected Containers</h2>
                  <button
                    type="button"
                    onClick={() => containers.refetch()}
                    className="text-xs text-slate-400 underline hover:text-slate-200"
                  >
                    Refresh
                  </button>
                </div>
                {containers.isLoading ? (
                  <p className="mt-2 text-sm text-slate-400">Listing containers…</p>
                ) : containers.isError ? (
                  <p className="mt-2 text-sm text-amber-300">
                    Docker list unavailable: {containers.error instanceof Error ? containers.error.message : 'unknown'}{' '}
                    <span className="text-slate-400">(Is the daemon running?)</span>
                  </p>
                ) : (containers.data ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No containers found.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {(containers.data ?? []).map((c) => (
                      <li
                        key={c.name}
                        className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950 p-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm text-slate-100">{c.name}</span>
                          <span className="text-[11px] text-slate-500">
                            {c.status}
                            {c.health ? ` · health ${c.health}` : ''}
                            {c.project ? ` · ${c.project}` : ''}
                          </span>
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            c.status.toLowerCase().includes('run')
                              ? 'bg-emerald-900 text-emerald-200'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {c.status.toUpperCase() || 'UNKNOWN'}
                        </span>
                        <button
                          type="button"
                          onClick={() => attach(c.name)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                        >
                          View Logs
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAttached(c.name);
                            void diagnoseAttached();
                          }}
                          className="rounded border border-violet-700 px-2 py-1 text-xs text-violet-200 hover:bg-violet-900"
                        >
                          Diagnose
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">Paste logs manually</h2>
              <p className="text-xs text-slate-500">
                Same evidence extractor as the Docker watcher. Needs a real traceback / OOM / exit-code line —
                plain “hello” is rejected with 422.
              </p>
              <div className="flex gap-2">
                <label className="flex-1 text-xs">
                  Project
                  <input
                    value={manualProject}
                    onChange={(e) => setManualProject(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm"
                  />
                </label>
                <label className="flex-1 text-xs">
                  Container (optional)
                  <input
                    value={manualContainer}
                    onChange={(e) => setManualContainer(e.target.value)}
                    placeholder="crashme-1"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm"
                  />
                </label>
              </div>
              <textarea
                aria-label="Raw logs to analyze"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={8}
                placeholder={'Traceback (most recent call last):\n  ...\nZeroDivisionError: division by zero'}
                className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={submitManual}
                disabled={busy === 'manual' || !manualText.trim()}
                className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
              >
                {busy === 'manual' ? 'Recording…' : 'Record incident'}
              </button>
            </div>
          )}

          {tab === 'copilot' && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-200">Ask SRE Copilot</h2>
              <p className="text-xs text-slate-500">
                Stateless Q&amp;A grounded in runbooks + optional incident. No actions are taken.
              </p>
              <input
                aria-label="Incident ID (optional)"
                value={copilotIncident}
                onChange={(e) => setCopilotIncident(e.target.value)}
                placeholder="Incident ID (optional)"
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
              />
              <textarea
                aria-label="Question for copilot"
                value={copilotQ}
                onChange={(e) => setCopilotQ(e.target.value)}
                rows={4}
                placeholder="Why did this container crash and what should I check first?"
                className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
              />
              <button
                type="button"
                onClick={ask}
                disabled={busy === 'copilot' || !copilotQ.trim()}
                className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
              >
                {busy === 'copilot' ? 'Asking…' : 'Ask'}
              </button>
              {copilotOut && (
                <div className="rounded border border-slate-800 bg-slate-950 p-2 text-sm">
                  <p className="text-slate-100">{copilotOut.answer}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    model {copilotOut.actual_model || '—'} · {copilotOut.total_tokens} tokens
                    {copilotOut.confidence !== null ? ` · confidence ${copilotOut.confidence}` : ''}
                    {(copilotOut.evidence_ids ?? []).length > 0 &&
                      ` · evidence ${(copilotOut.evidence_ids ?? []).join(', ')}`}
                    {(copilotOut.runbook_ids ?? []).length > 0 &&
                      ` · runbooks ${(copilotOut.runbook_ids ?? []).join(', ')}`}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT column: log viewer + diagnose */}
        <section className="space-y-3 rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-200">
              {attached ? (
                <>
                  Logs: <span className="font-mono text-slate-100">{attached}</span>
                </>
              ) : (
                'Attach a container to stream logs'
              )}
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <label>
                Tail{' '}
                <select
                  value={tail}
                  onChange={(e) => setTail(Number(e.target.value))}
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5"
                >
                  {[100, 200, 500].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => logs.refetch()}
                disabled={!attached}
                className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {!attached ? (
            <p className="text-sm text-slate-400">
              Pick a container on the left (or type its name above). The tail refreshes every 10s.
            </p>
          ) : logs.isLoading ? (
            <p className="text-sm text-slate-400">Loading logs…</p>
          ) : logs.isError ? (
            <p role="alert" className="text-sm text-amber-300">
              Could not load logs: {logs.error instanceof Error ? logs.error.message : 'unknown error'}
            </p>
          ) : (logs.data?.lines ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No log lines returned.</p>
          ) : (
            <>
              {logs.data?.truncated && (
                <p className="text-[11px] text-amber-300">Output truncated to the most recent 100k characters.</p>
              )}
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-xs text-slate-300">
                {(logs.data?.lines ?? []).join('\n')}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={diagnoseAttached}
                  disabled={busy === 'diagnose'}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busy === 'diagnose' ? 'Recording…' : 'Diagnose these logs'}
                </button>
                {madeIncident && (
                  <>
                    <button
                      type="button"
                      onClick={() => runInvestigation(madeIncident.id)}
                      disabled={busy === 'investigate'}
                      className="rounded-md border border-emerald-700 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-950 disabled:opacity-50"
                    >
                      {busy === 'investigate' ? 'Starting…' : `Investigate with ${effectiveModel || 'default engine'}`}
                    </button>
                    <Link
                      to={`/incidents/${madeIncident.id}`}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
                      title="Each investigation on the incident page has its own .docx report download."
                    >
                      Open incident for .docx report →
                    </Link>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Diagnose records one incident (deduplicated by fingerprint). Investigation runs explicitly with the
                engine shown above — free models only, rejected otherwise.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
