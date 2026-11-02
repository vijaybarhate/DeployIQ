import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  Bot,
  ClipboardPaste,
  Cpu,
  KeyRound,
  RefreshCw,
  Stethoscope,
  Terminal,
} from 'lucide-react';

import { ApiError } from '../../lib/api/client';
import { askCopilot, containerLogs, manualIngest } from '../../lib/api/console';
import { triggerInvestigation } from '../../lib/api/investigations';
import { formatClockTime } from '../../lib/time';
import { useContainers, useContainerLogs, useHealth, useModels, useModelStatus } from '../../hooks/queries';
import type { CopilotAnswer, Incident } from '../../types/api';

type Tab = 'live' | 'manual' | 'copilot';

const MODEL_KEY = 'deployiq-model';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Terminal }> = [
  { id: 'live', label: 'Live Docker', Icon: Terminal },
  { id: 'manual', label: 'Manual Logs', Icon: ClipboardPaste },
  { id: 'copilot', label: 'SRE Copilot', Icon: Bot },
];

function loadModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}

function shortModel(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return tail.length > 34 ? `${tail.slice(0, 32)}…` : tail;
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
  const engineHealth = useModelStatus(effectiveModel);
  const engineDot =
    engineHealth.status === 'live'
      ? 'bg-emerald-400'
      : engineHealth.status === 'checking'
        ? 'bg-amber-400'
        : engineHealth.status === 'down'
          ? 'bg-red-400'
          : 'bg-slate-600';
  const engineText =
    engineHealth.status === 'live'
      ? `live${engineHealth.latencyMs !== null ? ` · ${engineHealth.latencyMs}ms` : ''}`
      : engineHealth.status === 'checking'
        ? 'checking…'
        : engineHealth.status === 'down'
          ? 'down'
          : 'not checked';
  const engineTitle =
    engineHealth.status === 'live'
      ? `Model answered the health ping${engineHealth.actualModel ? ` as ${engineHealth.actualModel}` : ''}${engineHealth.latencyMs !== null ? ` in ${engineHealth.latencyMs}ms` : ''}.`
      : engineHealth.status === 'down'
        ? `Model health check failed: ${engineHealth.error ?? 'unknown error'}`
        : engineHealth.status === 'checking'
          ? 'Pinging the selected model…'
          : 'Pick a model to verify it automatically.';

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

  async function diagnoseContainer(name: string) {
    setBusy('diagnose');
    setError(null);
    setNotice(null);
    try {
      const tailLogs = await containerLogs(name, 500);
      const text = tailLogs.lines.join('\n');
      if (!text.trim()) {
        setError('No log lines to diagnose for this container.');
        return;
      }
      const incident = await manualIngest({
        project_id: 'demo',
        raw_logs: text.slice(-20000),
        container_name: name,
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

  const logLines = logs.data?.lines ?? [];

  return (
    <div className="space-y-5">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-emerald-400">
            DeployIQ // Autonomous SRE Agent
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">
            Operations console
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Docker, evidence, and AI diagnosis in one place. Everything here is read-only
            until you explicitly record an incident.
          </p>
        </div>
        {/* Status cluster */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex min-h-[36px] items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900 py-1 pl-2.5 pr-3 font-mono text-xs text-slate-300">
            <span className="relative flex h-2 w-2" aria-hidden>
              {dockerConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  dockerConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </span>
            docker:{dockerConnected === null ? '…' : dockerConnected ? 'connected' : 'down'}
          </span>
          <label
            className="flex min-h-[36px] items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900 py-1 pl-2.5 pr-2.5 text-xs text-slate-300"
            title={engineTitle}
            data-tour="console-engine"
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              {(engineHealth.status === 'live' || engineHealth.status === 'checking') && (
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${engineDot}`}
                />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${engineDot}`} />
            </span>
            <Cpu className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <span className="sr-only">AI engine (free models only)</span>
            <select
              aria-label="AI engine (free models only)"
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
              className="max-w-[230px] cursor-pointer bg-transparent font-mono text-xs text-slate-100 outline-none"
              title={effectiveModel || 'Default engine'}
            >
              {modelOptions.length === 0 && <option value="">openrouter/free</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id} className="bg-slate-900" title={m.id}>
                  {shortModel(m.name || m.id)}
                </option>
              ))}
            </select>
            <span
              role="status"
              aria-live="polite"
              className={`font-mono text-[11px] ${
                engineHealth.status === 'live'
                  ? 'text-emerald-300'
                  : engineHealth.status === 'checking'
                    ? 'text-amber-300'
                    : engineHealth.status === 'down'
                      ? 'text-red-300'
                      : 'text-slate-500'
              }`}
            >
              {engineText}
            </span>
          </label>
          <span
            title="The backend uses the server OPENROUTER_API_KEY. No key is typed or stored in the browser."
            className="flex min-h-[36px] cursor-help items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-xs text-slate-400"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            server key
          </span>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          {notice}{' '}
          {madeIncident && (
            <Link to={`/incidents/${madeIncident.id}`} className="font-medium underline underline-offset-2">
              Open incident →
            </Link>
          )}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* LEFT rail: input */}
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#0a0f1a]">
          <div
            className="flex gap-1 border-b border-slate-800/80 p-2"
            role="tablist"
            aria-label="Console input"
            data-tour="console-tabs"
          >
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={active}
                  className={`flex min-h-[40px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-medium transition-colors duration-200 ${
                    active
                      ? 'bg-emerald-400 text-slate-950'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="p-4">
            {tab === 'live' && (
              <div className="space-y-4">
                <div data-tour="console-attach">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    01 — Attach
                  </p>
                  <label
                    htmlFor="target-container"
                    className="mt-2 block text-[13px] font-medium text-slate-300"
                  >
                    Target Container:
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="target-container"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void attach(target);
                      }}
                      placeholder="container name, e.g. crashme-1"
                      spellCheck={false}
                      autoComplete="off"
                      className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[13px] text-slate-100 placeholder:text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => attach(target)}
                      className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-slate-950 transition-colors duration-200 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Attach &amp; Stream
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Read-only tail, refreshed every 10s. Nothing is executed inside containers.
                  </p>
                </div>

                <div data-tour="console-containers">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      02 — Detected Containers
                    </p>
                    <button
                      type="button"
                      onClick={() => containers.refetch()}
                      className="flex min-h-[32px] cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-slate-400 transition-colors duration-200 hover:text-slate-100"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden />
                      Refresh
                    </button>
                  </div>
                  {containers.isLoading ? (
                    <p className="mt-2 text-sm text-slate-400">Listing containers…</p>
                  ) : containers.isError ? (
                    <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/30 p-2.5 text-[13px] text-amber-200">
                      Docker list unavailable:{' '}
                      {containers.error instanceof Error ? containers.error.message : 'unknown'}{' '}
                      <span className="text-amber-200/70">(Is the daemon running?)</span>
                    </p>
                  ) : (containers.data ?? []).length === 0 ? (
                    <p className="mt-2 text-sm text-slate-400">No containers found.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {(containers.data ?? []).map((c) => {
                        const running = c.status.toLowerCase().includes('run');
                        const isAttached = attached === c.name;
                        return (
                          <li
                            key={c.name}
                            className={`rounded-lg border p-2.5 transition-colors duration-200 ${
                              isAttached
                                ? 'border-emerald-400/40 bg-emerald-400/[0.04]'
                                : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className={`h-1.5 w-1.5 flex-none rounded-full ${
                                  running ? 'bg-emerald-400' : 'bg-slate-600'
                                }`}
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-100">
                                {c.name}
                              </span>
                              <span
                                className={`flex-none rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${
                                  running
                                    ? 'bg-emerald-400/10 text-emerald-300'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {c.status.toUpperCase() || 'UNKNOWN'}
                              </span>
                            </span>
                            <span className="mt-1 block truncate font-mono text-[11px] text-slate-500">
                              {c.health ? `health:${c.health}` : 'health:—'}
                              {c.project ? ` · ${c.project}` : ''}
                              {c.short_id ? ` · ${c.short_id}` : ''}
                            </span>
                            <span className="mt-2 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => attach(c.name)}
                                className="flex min-h-[36px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-slate-700 px-2 text-xs font-medium text-slate-200 transition-colors duration-200 hover:border-slate-500 hover:bg-slate-800"
                              >
                                <Terminal className="h-3.5 w-3.5" aria-hidden />
                                View Logs
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAttached(c.name);
                                  void diagnoseContainer(c.name);
                                }}
                                className="flex min-h-[36px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-emerald-500/40 px-2 text-xs font-medium text-emerald-300 transition-colors duration-200 hover:bg-emerald-400/10"
                              >
                                <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                                Diagnose
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {tab === 'manual' && (
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Paste logs manually
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Same evidence extractor as the Docker watcher. Needs a real traceback / OOM /
                    exit-code line — plain “hello” is rejected with 422.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-slate-300">
                    Project
                    <input
                      value={manualProject}
                      onChange={(e) => setManualProject(e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-[13px]"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-300">
                    Container <span className="font-normal text-slate-500">(optional)</span>
                    <input
                      value={manualContainer}
                      onChange={(e) => setManualContainer(e.target.value)}
                      placeholder="crashme-1"
                      spellCheck={false}
                      autoComplete="off"
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-[13px] placeholder:text-slate-600"
                    />
                  </label>
                </div>
                <textarea
                  aria-label="Raw logs to analyze"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  placeholder={'Traceback (most recent call last):\n  ...\nZeroDivisionError: division by zero'}
                  className="terminal-scroll w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={submitManual}
                  disabled={busy === 'manual' || !manualText.trim()}
                  className="min-h-[44px] w-full cursor-pointer rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition-colors duration-200 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'manual' ? 'Recording…' : 'Record incident'}
                </button>
              </div>
            )}

            {tab === 'copilot' && (
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    Ask SRE Copilot
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Stateless Q&amp;A grounded in runbooks + optional incident. No actions are taken.
                  </p>
                </div>
                <input
                  aria-label="Incident ID (optional)"
                  value={copilotIncident}
                  onChange={(e) => setCopilotIncident(e.target.value)}
                  placeholder="Incident ID (optional)"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-h-[40px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs placeholder:text-slate-600"
                />
                <textarea
                  aria-label="Question for copilot"
                  value={copilotQ}
                  onChange={(e) => setCopilotQ(e.target.value)}
                  rows={4}
                  placeholder="Why did this container crash and what should I check first?"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm leading-relaxed placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={ask}
                  disabled={busy === 'copilot' || !copilotQ.trim()}
                  className="min-h-[44px] w-full cursor-pointer rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 transition-colors duration-200 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'copilot' ? 'Asking…' : 'Ask'}
                </button>
                {copilotOut && (
                  <div className="rounded-lg border border-slate-800 border-l-2 border-l-emerald-400 bg-slate-950 p-3 text-sm">
                    <p className="leading-relaxed text-slate-100">{copilotOut.answer}</p>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-500">
                      {copilotOut.actual_model || '—'} · {copilotOut.total_tokens} tokens
                      {copilotOut.confidence !== null ? ` · conf ${copilotOut.confidence}` : ''}
                      {(copilotOut.evidence_ids ?? []).length > 0 &&
                        ` · ${(copilotOut.evidence_ids ?? []).join(', ')}`}
                      {(copilotOut.runbook_ids ?? []).length > 0 &&
                        ` · ${(copilotOut.runbook_ids ?? []).join(', ')}`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT: terminal */}
        <section
          className="overflow-hidden rounded-xl border border-slate-800 bg-[#0a0f1a]"
          data-tour="console-terminal"
        >
          {/* Window chrome */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-950/60 px-3 py-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span
                className={`h-2.5 w-2.5 rounded-full ${attached ? 'bg-emerald-400/70' : 'bg-slate-700'}`}
              />
            </span>
            <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate font-mono text-xs text-slate-300">
              {attached ? (
                <>
                  <span
                    className="flex flex-none items-center gap-1 rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-widest text-emerald-300"
                    title="Auto-refreshing every 10s, plus on window focus"
                  >
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    LIVE
                  </span>
                  <span className="truncate">
                    live tail — <span className="text-slate-100">{attached}</span>
                  </span>
                </>
              ) : (
                <span className="text-slate-500">no container attached</span>
              )}
            </h2>
            {attached && !logs.isLoading && (
              <span
                className="font-mono text-[11px] tabular-nums text-slate-500"
                title="Last successful tail refresh (auto-refreshes every 10s)"
              >
                {logs.isFetching ? 'updating…' : `updated ${formatClockTime(logs.dataUpdatedAt)}`}
              </span>
            )}
            <label className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
              tail
              <select
                value={tail}
                onChange={(e) => setTail(Number(e.target.value))}
                className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
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
              disabled={!attached || logs.isFetching}
              aria-label="Refresh logs"
              title="Refresh logs"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${logs.isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
            </button>
          </div>

          {!attached ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950">
                <Terminal className="h-5 w-5 text-slate-500" aria-hidden />
              </span>
              <p className="text-sm font-medium text-slate-200">Attach a container to stream logs</p>
              <p className="max-w-sm text-xs leading-relaxed text-slate-500">
                Pick a container on the left, or type its name above. The tail refreshes every 10s
                and never executes anything inside the container.
              </p>
            </div>
          ) : logs.isLoading ? (
            <p className="px-4 py-10 text-center font-mono text-xs text-slate-500">
              <span className="animate-pulse">▊ connecting to {attached}…</span>
            </p>
          ) : logs.isError ? (
            <p role="alert" className="m-4 rounded-lg border border-amber-500/25 bg-amber-950/30 p-3 text-sm text-amber-200">
              Could not load logs:{' '}
              {logs.error instanceof Error ? logs.error.message : 'unknown error'}
            </p>
          ) : logLines.length === 0 ? (
            <p className="px-4 py-10 text-center font-mono text-xs text-slate-500">
              — no log lines returned —
            </p>
          ) : (
            <div>
              {logs.data?.truncated && (
                <p className="border-b border-amber-500/20 bg-amber-950/20 px-4 py-1.5 font-mono text-[11px] text-amber-300">
                  truncated — showing the most recent 100k characters
                </p>
              )}
              <pre className="terminal-scroll terminal-grid log-lines max-h-[480px] overflow-auto px-3 py-3 font-mono text-xs leading-[1.7] text-slate-300">
                {logLines.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: log tail has no stable ids; index is the order
                  <div key={i} className="log-line">
                    <span className="whitespace-pre-wrap break-all">{line}</span>
                  </div>
                ))}
              </pre>
              <div className="space-y-2.5 border-t border-slate-800/80 p-4" data-tour="console-diagnose">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => diagnoseContainer(attached)}
                    disabled={busy === 'diagnose'}
                    className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors duration-200 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Stethoscope className="h-4 w-4" aria-hidden />
                    {busy === 'diagnose' ? 'Recording…' : 'Diagnose these logs'}
                  </button>
                  {madeIncident && (
                    <>
                      <button
                        type="button"
                        onClick={() => runInvestigation(madeIncident.id)}
                        disabled={busy === 'investigate'}
                        className="flex min-h-[44px] cursor-pointer items-center rounded-lg border border-emerald-500/40 px-3.5 py-2 text-sm font-medium text-emerald-300 transition-colors duration-200 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === 'investigate'
                          ? 'Starting…'
                          : `Investigate · ${shortModel(effectiveModel) || 'default'}`}
                      </button>
                      <Link
                        to={`/incidents/${madeIncident.id}`}
                        className="flex min-h-[44px] items-center rounded-lg border border-slate-700 px-3.5 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:text-white"
                        title="Each investigation on the incident page has its own .docx report download."
                      >
                        Open incident →
                      </Link>
                    </>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Diagnose records one incident (deduplicated by fingerprint). Investigation runs
                  explicitly with the engine shown above — free models only.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
