import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  Bot,
  ChevronDown,
  ClipboardPaste,
  Cpu,
  KeyRound,
  RefreshCw,
  Stethoscope,
  Terminal,
} from 'lucide-react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../lib/api/client';
import { askCopilot, containerLogs, listModelKeys, listModelStatuses, manualIngest } from '../../lib/api/console';
import { triggerInvestigation } from '../../lib/api/investigations';
import { formatClockTime } from '../../lib/time';
import {
  isInvestigationActive,
  useContainers,
  useContainerLogs,
  useHealth,
  useInvestigations,
  useModelKeys,
  useModels,
  useModelStatuses,
  useModelStatus,
} from '../../hooks/queries';
import { useNow } from '../../hooks/useNow';
import type { CopilotAnswer, Incident } from '../../types/api';
import { InvestigationCard } from '../investigations/InvestigationCard';

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

const MODEL_DOT: Record<string, string> = {
  live: 'bg-emerald-400',
  limited: 'bg-amber-400',
  slow: 'bg-amber-400',
  down: 'bg-red-400',
  unknown: 'bg-slate-600',
};

const MODEL_TEXT: Record<string, string> = {
  live: 'text-emerald-300',
  limited: 'text-amber-300',
  slow: 'text-amber-300',
  down: 'text-red-300',
  unknown: 'text-muted',
};

function engineRowDot(status: string): string {
  return MODEL_DOT[status] ?? MODEL_DOT.unknown;
}

function engineRowText(status: string): string {
  return MODEL_TEXT[status] ?? MODEL_TEXT.unknown;
}

function engineRowLabel(m: { status: string; latency_ms: number | null; reason: string }): string {
  if (m.status === 'live' && typeof m.latency_ms === 'number') return `live · ${m.latency_ms}ms`;
  if (m.status === 'live') return 'live';
  if (m.status === 'limited') return 'limited';
  if (m.status === 'slow') return 'timed out';
  if (m.status === 'down') return m.reason || 'down';
  return 'not checked';
}

export function OpsConsolePage() {
  const [tab, setTab] = useState<Tab>('live');
  const [target, setTarget] = useState('');
  const [attached, setAttached] = useState<string | null>(null);
  const [containerQuery, setContainerQuery] = useState('');
  const [tail, setTail] = useState(200);
  const [model, setModel] = useState(loadModel);
  const [engineOpen, setEngineOpen] = useState(false);
  const [statusesRefreshing, setStatusesRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [madeIncident, setMadeIncident] = useState<Incident | null>(null);

  const [manualProject, setManualProject] = useState('');
  const [manualContainer, setManualContainer] = useState('');
  const [manualText, setManualText] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [keysRefreshing, setKeysRefreshing] = useState(false);
  const keyButtonRef = useRef<HTMLButtonElement>(null);

  const [copilotQ, setCopilotQ] = useState('');
  const [copilotIncident, setCopilotIncident] = useState('');
  const [copilotOut, setCopilotOut] = useState<CopilotAnswer | null>(null);

  const queryClient = useQueryClient();
  const health = useHealth();
  const containers = useContainers();
  const models = useModels();
  const logs = useContainerLogs(attached, tail);
  // Diagnostic state for the right panel: history of the recorded incident,
  // polled while any investigation is active (same rhythm as details page).
  const history = useInvestigations(madeIncident?.id);
  const historyActive = (history.data ?? []).some((i) => isInvestigationActive(i.status));
  const nowMs = useNow(historyActive);
  const { refetch: refetchHistory } = history;
  useEffect(() => {
    if (!historyActive) return undefined;
    const timer = setInterval(() => {
      void refetchHistory();
    }, 5000);
    return () => clearInterval(timer);
  }, [historyActive, refetchHistory]);
  // While a trigger POST is in flight the history may still be empty, so the
  // active-poll above would never start: poll explicitly during the request.
  // The endpoint is synchronous, so this only surfaces progress when a prior
  // attempt is already running; the post-trigger refetch shows the result.
  useEffect(() => {
    if (busy !== 'investigate' || !madeIncident) return undefined;
    const timer = setInterval(() => {
      void refetchHistory();
    }, 5000);
    return () => clearInterval(timer);
  }, [busy, madeIncident, refetchHistory]);

  useEffect(() => {
    try {
      if (model) localStorage.setItem(MODEL_KEY, model);
      else localStorage.removeItem(MODEL_KEY);
    } catch {
      /* private mode: picker still works for this session */
    }
  }, [model]);

  const dockerConnected = health.data?.docker.connected ?? null;
  const modelOptions = useMemo(() => models.data ?? [], [models.data]);
  const statuses = useModelStatuses();
  const keyStatuses = useModelKeys();
  const liveKeys = (keyStatuses.data ?? []).filter((k) => k.status === 'live').length;
  const totalKeys = (keyStatuses.data ?? []).length;
  // Ranked by availability then speed (backend pre-sorts); fall back to the
  // plain catalogue while statuses load so the picker never sits empty.
  const rankedModels = useMemo(() => {
    const live = statuses.data;
    if (Array.isArray(live) && live.length > 0) {
      return live.filter((e) => e && typeof e.id === 'string');
    }
    return modelOptions.map((m) => ({
      id: m.id,
      name: m.name,
      status: 'unknown' as const,
      latency_ms: null as number | null,
      reason: '',
    }));
  }, [statuses.data, modelOptions]);
  const liveCount = rankedModels.filter((m) => m.status === 'live').length;
  // Default to the fastest answering model so the first pick is usable;
  // an explicit user pick (persisted) always wins.
  const effectiveModel =
    model || rankedModels.find((m) => m.status === 'live')?.id || rankedModels[0]?.id || '';
  const engineHealth = useModelStatus(effectiveModel);
  const engineButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!engineOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        engineButtonRef.current &&
        !engineButtonRef.current.contains(el) &&
        !el?.closest?.('[data-engine-list]')
      ) {
        setEngineOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEngineOpen(false);
        engineButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [engineOpen]);
  const engineDot =
    engineHealth.status === 'live'
      ? 'bg-emerald-400'
      : engineHealth.status === 'checking'
        ? 'bg-amber-400'
        : engineHealth.status === 'limited' || engineHealth.status === 'slow'
          ? 'bg-amber-400'
          : engineHealth.status === 'down'
            ? 'bg-red-400'
            : 'bg-slate-600';
  const engineText =
    engineHealth.status === 'live'
      ? `live${engineHealth.latencyMs !== null ? ` · ${engineHealth.latencyMs}ms` : ''}`
      : engineHealth.status === 'checking'
        ? 'checking…'
        : engineHealth.status === 'limited'
          ? 'limited'
          : engineHealth.status === 'slow'
            ? 'slow'
            : engineHealth.status === 'down'
              ? 'down'
              : 'not checked';
  const engineTitle =
    engineHealth.status === 'live'
      ? `Model answered the health ping${engineHealth.actualModel ? ` as ${engineHealth.actualModel}` : ''}${engineHealth.latencyMs !== null ? ` in ${engineHealth.latencyMs}ms` : ''}.`
      : engineHealth.status === 'limited'
        ? 'Model is rate-limited right now — pick a live one for the demo.'
        : engineHealth.status === 'slow'
          ? 'Model timed out — pick a faster live one for the demo.'
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

  function handleCiteEvidence(anchorId: string) {
    const el = document.getElementById(anchorId);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('ring-2', 'ring-emerald-500');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-500'), 1600);
    }
  }

  async function refreshStatuses() {
    // Bypass the 120s server cache on explicit user request: the button must
    // re-ping the models, not just re-read cached verdicts.
    setStatusesRefreshing(true);
    try {
      const fresh = await listModelStatuses(true);
      queryClient.setQueryData(['model-statuses'], fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model status refresh failed');
    } finally {
      setStatusesRefreshing(false);
    }
  }

  async function refreshKeys() {
    setKeysRefreshing(true);
    try {
      const fresh = await listModelKeys(true);
      queryClient.setQueryData(['model-keys'], fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key status refresh failed');
    } finally {
      setKeysRefreshing(false);
    }
  }

  useEffect(() => {
    if (!keyOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        keyButtonRef.current &&
        !keyButtonRef.current.contains(el) &&
        !el?.closest?.('[data-key-list]')
      ) {
        setKeyOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setKeyOpen(false);
        keyButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [keyOpen]);
  async function diagnoseContainer(name: string, project?: string) {
    setBusy('diagnose');
    setError(null);
    setNotice(null);
    // Scope to the container's own Compose project: the backend fail-closes
    // on unlisted projects. No fallback — an unknown project refuses rather
    // than guessing its way into scope.
    const scope = (project || containers.data?.find((c) => c.name === name)?.project || '').trim();
    if (!scope) {
      setError('Container project unknown — refusing to diagnose outside the monitored scope.');
      setBusy(null);
      return;
    }
    try {
      const tailLogs = await containerLogs(name, 500);
      const text = tailLogs.lines.join('\n');
      if (!text.trim()) {
        setError('No log lines to diagnose for this container.');
        return;
      }
      const incident = await manualIngest({
        project_id: scope,
        raw_logs: text.slice(-20000),
        container_name: name,
      });
      setMadeIncident(incident);
      setNotice(`Incident ${incident.title} recorded. Open it to run AI investigation.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError(
          'These logs contain no crash evidence (no traceback, OOM, or exit lines). ' +
            'Attach crashme-boom — or hit its /boom endpoint first — then Diagnose again.',
        );
      } else if (err instanceof ApiError && err.status === 403) {
        setError(`Container project '${scope}' is outside the monitored scope.`);
      } else {
        setError(err instanceof Error ? err.message : 'Diagnose failed');
      }
    } finally {
      setBusy(null);
    }
  }

  async function runInvestigation(incidentId: string) {
    setBusy('investigate');
    setError(null);
    try {
      // The endpoint is synchronous: it returns only after the run finishes,
      // so the returned record (or persisted failure) must be pulled into
      // history explicitly — otherwise the panel stays stuck on "no
      // investigations yet" and polling never starts.
      await triggerInvestigation(incidentId, effectiveModel || undefined);
      await history.refetch();
      setNotice('Investigation finished — report below. Open the incident for history and .docx.');
    } catch (err) {
      // A failed attempt may already be persisted server-side: refresh so
      // the failure (not silence) is what the panel shows.
      await history.refetch().catch(() => undefined);
      if (err instanceof ApiError && err.status === 422) {
        setError(`Model rejected: ${err.message}`);
      } else if (err instanceof ApiError && err.status === 409) {
        setError('An investigation is already active for this incident. History refreshed.');
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
    const project = manualProject.trim();
    if (!project) {
      // No silent default: pasted logs must be attributed explicitly,
      // otherwise they land in the wrong project's incidents.
      setError('Project is required — type the Compose project these logs came from.');
      setBusy(null);
      return;
    }
    try {
      const incident = await manualIngest({
        project_id: project,
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

  // Local filter for the detected list: with many containers on one daemon
  // (e.g. other projects), typing a few letters beats scrolling.
  const containerFilter = containerQuery.trim().toLowerCase();
  const visibleContainers = (containers.data ?? []).filter(
    (c) =>
      !containerFilter ||
      c.name.toLowerCase().includes(containerFilter) ||
      c.status.toLowerCase().includes(containerFilter) ||
      (c.project || '').toLowerCase().includes(containerFilter) ||
      (c.health || '').toLowerCase().includes(containerFilter),
  );

  // Group by Compose project; EXITED containers collapse into a native
  // <details> so dead ones never crowd out the running ones.
  const containerGroups = useMemo(() => {
    const groups = new Map<string, typeof visibleContainers>();
    for (const c of visibleContainers) {
      const key = c.project || 'no project';
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    return [...groups.entries()].map(([project, list]) => ({
      project,
      active: list.filter((c) => !c.status.toLowerCase().includes('exit')),
      exited: list.filter((c) => c.status.toLowerCase().includes('exit')),
    }));
  }, [visibleContainers]);

  function containerRow(c: (typeof visibleContainers)[number]) {
    const running = c.status.toLowerCase().includes('run');
    const isAttached = attached === c.name;
    return (
      <li
        key={c.name}
        className={`py-2 first:pt-0 last:pb-0 ${isAttached ? 'bg-emerald-400/[0.04]' : ''}`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 flex-none rounded-full ${
              running ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
            {c.name}
          </span>
          <span className="flex-none font-mono text-[11px] text-muted">
            {c.status || 'unknown'}
          </span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
          {c.health ? `health:${c.health}` : 'health:—'}
          {c.short_id ? ` · ${c.short_id.slice(0, 12)}` : ''}
        </span>
        <span className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setAttached(c.name);
              void diagnoseContainer(c.name, c.project);
            }}
            className="flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-lavender px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
            Diagnose
          </button>
          <button
            type="button"
            onClick={() => attach(c.name)}
            className="flex min-h-[40px] cursor-pointer items-center px-1 text-[13px] text-muted underline-offset-4 transition-colors duration-200 hover:text-ink hover:underline"
          >
            View logs
          </button>
        </span>
      </li>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.02em] text-ink">
            Operations console
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            DeployIQ watches configured Docker projects, groups repeated errors into
            incidents, and turns captured logs and runbooks into AI-assisted root-cause reports.
          </p>
        </div>
        {/* Status cluster */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex min-h-[36px] items-center gap-2 rounded-full border border-hairline bg-panel py-1 pl-2.5 pr-3 font-mono text-xs text-body">
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
          <div className="relative" data-tour="console-engine" title={engineTitle}>
            <button
              ref={engineButtonRef}
              type="button"
              aria-label="AI engine (free models only)"
              aria-haspopup="listbox"
              aria-expanded={engineOpen}
              onClick={() => setEngineOpen((o) => !o)}
              className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-full border border-hairline bg-panel py-1 pl-2.5 pr-2.5 text-xs text-body transition-colors duration-200 hover:border-muted"
            >
              <span className="relative flex h-2 w-2" aria-hidden>
                {(engineHealth.status === 'live' || engineHealth.status === 'checking') && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${engineDot}`}
                  />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${engineDot}`} />
              </span>
              <Cpu className="h-3.5 w-3.5 text-muted" aria-hidden />
              <span className="max-w-[220px] truncate font-mono text-xs text-ink">
                {shortModel(effectiveModel || 'openrouter/free')}
              </span>
              <span
                role="status"
                aria-live="polite"
                className={`font-mono text-[11px] ${
                  engineHealth.status === 'live'
                    ? 'text-emerald-300'
                    : engineHealth.status === 'checking'
                      ? 'text-amber-300'
                      : engineHealth.status === 'limited' || engineHealth.status === 'slow'
                        ? 'text-amber-300'
                        : engineHealth.status === 'down'
                          ? 'text-red-300'
                          : 'text-muted'
                }`}
              >
                {engineText}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted transition-transform duration-200 ${engineOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {engineOpen && (
              <ul
                role="listbox"
                aria-label="Free models by live availability"
                data-engine-list
                className="terminal-scroll absolute right-0 z-40 mt-2 max-h-80 w-72 overflow-auto rounded-xl border border-hairline bg-raised p-1.5 shadow-[0_12px_40px_rgba(26,26,26,0.14)]"
              >
                {rankedModels.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted">No models loaded yet…</li>
                )}
                {rankedModels.map((m) => (
                  <li key={m.id} role="option" aria-selected={m.id === effectiveModel}>
                    <button
                      type="button"
                      onClick={() => {
                        setModel(m.id);
                        setEngineOpen(false);
                      }}
                      title={m.id}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                        m.id === effectiveModel ? 'bg-emerald-400/10' : 'hover:bg-raised/70'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 flex-none rounded-full ${engineRowDot(m.status)}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                        {shortModel(m.name || m.id)}
                      </span>
                      <span className={`flex-none font-mono text-[11px] ${engineRowText(m.status)}`}>
                        {engineRowLabel(m)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => void refreshStatuses()}
            disabled={statuses.isFetching || statusesRefreshing}
            aria-label="Re-check all models"
            title={
              statuses.dataUpdatedAt
                ? `Re-check all models (last checked ${formatClockTime(statuses.dataUpdatedAt)})`
                : 'Check all models now'
            }
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-hairline bg-panel text-muted transition-colors duration-200 hover:border-muted hover:text-ink disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statuses.isFetching || statusesRefreshing ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {statuses.dataUpdatedAt
              ? `${liveCount} of ${rankedModels.length} models live`
              : 'Model availability not checked yet'}
          </span>
          <div className="relative">
            <button
              ref={keyButtonRef}
              type="button"
              onClick={() => setKeyOpen((o) => !o)}
              aria-label="Server API keys health"
              aria-haspopup="dialog"
              aria-expanded={keyOpen}
              title="Pooled server keys — click to see which key is up or down (values never leave the backend)"
              className="flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-panel px-2.5 py-1 text-xs text-muted transition-colors duration-200 hover:border-muted hover:text-ink"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {totalKeys > 0 ? `${liveKeys}/${totalKeys} keys live` : 'server keys'}
            </button>
            {keyOpen && (
              <div
                role="dialog"
                aria-label="Server API key health"
                data-key-list
                className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-hairline bg-panel p-2 shadow-[0_12px_40px_rgba(26,26,26,0.14)]"
              >
                <p className="px-2.5 pb-1 pt-1.5 text-xs text-body">
                  Pooled server keys — values never leave the backend.
                </p>
                {(keyStatuses.data ?? []).length === 0 && !keyStatuses.isLoading && (
                  <p className="px-2.5 py-2 text-xs text-muted">No key status yet — checking…</p>
                )}
                <ul className="space-y-0.5">
                  {(keyStatuses.data ?? []).map((k) => (
                    <li
                      key={k.index}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 flex-none rounded-full ${engineRowDot(k.status)}`}
                      />
                      <span className="font-mono text-xs text-ink">Key {k.index}</span>
                      <span className={`ml-auto font-mono text-[11px] ${engineRowText(k.status)}`}>
                        {k.status === 'live' && typeof k.latency_ms === 'number'
                          ? `live · ${k.latency_ms}ms`
                          : k.status === 'limited'
                            ? 'limited — retry later'
                            : k.status === 'slow'
                              ? 'timed out'
                              : k.reason || k.status}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void refreshKeys()}
                  disabled={keysRefreshing || keyStatuses.isFetching}
                  className="mt-1 flex min-h-[36px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-hairline px-3 text-xs font-medium text-body transition-colors duration-200 hover:border-muted hover:text-ink disabled:cursor-wait disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${keysRefreshing ? 'animate-spin' : ''}`} aria-hidden />
                  {keysRefreshing ? 'Checking…' : 'Re-check keys'}
                </button>
              </div>
            )}
          </div>
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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {/* LEFT rail: input */}
          <section className="overflow-hidden rounded-xl border border-hairline bg-panel">
          <div
            className="flex gap-1 border-b border-hairline/80 p-2"
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
                  className={`flex min-h-[40px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[14px] font-semibold transition-colors duration-200 ${
                    active
                      ? 'bg-lavender text-ink'
                      : 'text-muted hover:bg-raised/70 hover:text-ink'
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
                  <h3 className="text-sm font-medium text-ink">Attach</h3>
                  <label
                    htmlFor="target-container"
                    className="mt-2 block text-[13px] font-medium text-body"
                  >
                    Target Container:
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="target-container"
                      name="target-container"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void attach(target);
                      }}
                      placeholder="container name, e.g. crashme-1"
                      spellCheck={false}
                      autoComplete="off"
                      className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-hairline bg-raised px-3 py-2 font-mono text-[13px] text-ink placeholder:text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => attach(target)}
                      className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-lavender px-3.5 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Attach &amp; Stream
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Read-only tail, refreshed every 10s. Nothing is executed inside containers.
                  </p>
                </div>

                <div data-tour="console-containers">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-ink">Containers</h3>
                    <button
                      type="button"
                      onClick={() => containers.refetch()}
                      disabled={containers.isFetching}
                      className="flex min-h-[32px] cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted transition-colors duration-200 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                      title="Re-list containers now"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${containers.isFetching ? 'animate-spin' : ''}`}
                        aria-hidden
                      />
                      {containers.isFetching ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                  {containers.isLoading ? (
                    <p className="mt-2 text-sm text-muted">Listing containers…</p>
                  ) : containers.isError ? (
                    <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/30 p-2.5 text-[13px] text-amber-200">
                      Docker list unavailable:{' '}
                      {containers.error instanceof Error ? containers.error.message : 'unknown'}{' '}
                      <span className="text-amber-200/70">(Is the daemon running?)</span>
                    </p>
                  ) : (containers.data ?? []).length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No containers found.</p>
                  ) : (
                    <>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="search"
                          aria-label="Search containers"
                          name="container-filter"
                          value={containerQuery}
                          onChange={(e) => setContainerQuery(e.target.value)}
                          placeholder="Filter by name, status, project…"
                          spellCheck={false}
                          autoComplete="off"
                          className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-hairline bg-raised px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-muted"
                        />
                        {containerFilter && (
                          <span className="flex-none font-mono text-[11px] tabular-nums text-muted">
                            {visibleContainers.length}/{(containers.data ?? []).length}
                          </span>
                        )}
                      </div>
                      {visibleContainers.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">
                          No containers match “{containerQuery.trim()}”.{' '}
                          <button
                            type="button"
                            onClick={() => setContainerQuery('')}
                            className="cursor-pointer underline underline-offset-2 hover:text-ink"
                          >
                            Clear
                          </button>
                        </p>
                      ) : (
                      <div className="mt-2 space-y-3">
                      {containerGroups.map((group) => (
                        <div key={group.project}>
                          {containerGroups.length > 1 && (
                            <p className="font-mono text-[11px] text-muted">{group.project}</p>
                          )}
                          {group.active.length > 0 && (
                            <ul className="divide-y divide-faint">
                              {group.active.map((c) => containerRow(c))}
                            </ul>
                          )}
                          {group.exited.length > 0 && (
                            <details className="mt-1">
                              <summary className="min-h-[32px] cursor-pointer py-1 text-xs text-muted transition-colors duration-200 hover:text-ink">
                                Exited ({group.exited.length})
                              </summary>
                              <ul className="divide-y divide-faint">
                                {group.exited.map((c) => containerRow(c))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ))}
                      </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === 'manual' && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Paste logs manually</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Same evidence extractor as the Docker watcher. Needs a real traceback / OOM /
                    exit-code line — plain “hello” is rejected with 422.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-body">
                    Project
                    <input
                      name="manual-project"
                      value={manualProject}
                      onChange={(e) => setManualProject(e.target.value)}
                      placeholder="deployiq-demo"
                      spellCheck={false}
                      autoComplete="off"
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-hairline bg-raised px-2.5 py-1.5 font-mono text-[13px] placeholder:text-muted"
                    />
                  </label>
                  <label className="text-xs font-medium text-body">
                    Container <span className="font-normal text-muted">(optional)</span>
                    <input
                      name="manual-container"
                      value={manualContainer}
                      onChange={(e) => setManualContainer(e.target.value)}
                      placeholder="crashme-1"
                      spellCheck={false}
                      autoComplete="off"
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-hairline bg-raised px-2.5 py-1.5 font-mono text-[13px] placeholder:text-muted"
                    />
                  </label>
                </div>
                <textarea
                  aria-label="Raw logs to analyze"
                  name="manual-logs"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  placeholder={'Traceback (most recent call last):\n  ...\nZeroDivisionError: division by zero'}
                  className="terminal-scroll w-full rounded-lg border border-hairline bg-raised p-2.5 font-mono text-xs leading-relaxed placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={submitManual}
                  disabled={busy === 'manual' || !manualText.trim()}
                  className="min-h-[44px] w-full cursor-pointer rounded-xl bg-lavender px-3 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'manual' ? 'Recording…' : 'Record incident'}
                </button>
              </div>
            )}

            {tab === 'copilot' && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Ask SRE Copilot</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    Stateless Q&amp;A grounded in runbooks + optional incident. No actions are taken.
                  </p>
                </div>
                <input
                  aria-label="Incident ID (optional)"
                  name="copilot-incident"
                  value={copilotIncident}
                  onChange={(e) => setCopilotIncident(e.target.value)}
                  placeholder="Incident ID (optional)"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-h-[40px] w-full rounded-lg border border-hairline bg-raised px-2.5 py-1.5 font-mono text-xs placeholder:text-muted"
                />
                <textarea
                  aria-label="Question for copilot"
                  name="copilot-question"
                  value={copilotQ}
                  onChange={(e) => setCopilotQ(e.target.value)}
                  rows={4}
                  placeholder="Why did this container crash and what should I check first?"
                  className="w-full rounded-lg border border-hairline bg-raised p-2.5 text-sm leading-relaxed placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={ask}
                  disabled={busy === 'copilot' || !copilotQ.trim()}
                  className="min-h-[44px] w-full cursor-pointer rounded-xl bg-lavender px-3 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'copilot' ? 'Asking…' : 'Ask'}
                </button>
                {copilotOut && (
                  <div className="rounded-lg border border-hairline bg-raised p-3 text-sm">
                    <p className="leading-relaxed text-ink">{copilotOut.answer}</p>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
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

        {/* LEFT: live terminal tail */}
        <section
          className="overflow-hidden rounded-[40px] bg-teal text-canvas"
          data-tour="console-terminal"
        >
          {/* Window chrome */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
              <span
                className={`h-2.5 w-2.5 rounded-full ${attached ? 'bg-lavender' : 'bg-white/25'}`}
              />
            </span>
            <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate font-mono text-xs text-canvas/70">
              {attached ? (
                <>
                  <span
                    className="flex flex-none items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-lavender"
                    title="Auto-refreshing every 10s, plus on window focus"
                  >
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lavender opacity-70 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lavender" />
                    </span>
                    LIVE
                  </span>
                  <span className="truncate">
                    live tail — <span className="text-canvas">{attached}</span>
                  </span>
                </>
              ) : (
                <span className="text-canvas/55">no container attached</span>
              )}
            </h2>
            {attached && !logs.isLoading && (
              <span
                className="font-mono text-[11px] tabular-nums text-muted"
                title="Last successful tail refresh (auto-refreshes every 10s)"
              >
                {logs.isFetching ? 'updating…' : `updated ${formatClockTime(logs.dataUpdatedAt)}`}
              </span>
            )}
            <label className="flex items-center gap-1 font-mono text-[11px] text-muted">
              lines
              <select
                value={tail}
                name="tail-lines"
                aria-label="Log lines to show"
                onChange={(e) => setTail(Number(e.target.value))}
                className="cursor-pointer rounded-md border border-white/20 bg-white/5 px-1.5 py-1 text-[11px] text-canvas"
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
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-white/20 text-canvas/70 transition-colors duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${logs.isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
            </button>
          </div>

          {!attached ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/5">
                <Terminal className="h-5 w-5 text-canvas/60" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-canvas">Attach a container to stream logs</p>
              <p className="max-w-sm text-xs leading-relaxed text-canvas/70">
                Pick a container on the left, or type its name above. The tail refreshes every 10s
                and never executes anything inside the container.
              </p>
            </div>
          ) : logs.isLoading ? (
            <p className="px-4 py-10 text-center font-mono text-xs text-canvas/60">
              <span className="animate-pulse">▊ connecting to {attached}…</span>
            </p>
          ) : logs.isError ? (
            <p role="alert" className="m-4 rounded-lg border border-amber-500/25 bg-amber-950/30 p-3 text-sm text-amber-200">
              Could not load logs:{' '}
              {logs.error instanceof Error ? logs.error.message : 'unknown error'}
            </p>
          ) : logLines.length === 0 ? (
            <p className="px-4 py-10 text-center font-mono text-xs text-canvas/60">
              — no log lines returned —
            </p>
          ) : (
            <div>
              {logs.data?.truncated && (
                <p className="border-b border-[#FFA946]/30 bg-[rgba(255,169,70,0.15)] px-4 py-1.5 font-mono text-[11px] text-[#FFCF8C]">
                  truncated — showing the most recent 100k characters
                </p>
              )}
              <pre className="terminal-scroll log-lines max-h-[480px] overflow-auto px-3 py-3 font-mono text-xs leading-[1.7] text-canvas/85">
                {logLines.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: log tail has no stable ids; index is the order
                  <div key={i} className="log-line">
                    <span className="whitespace-pre-wrap break-all">{line}</span>
                  </div>
                ))}
              </pre>
              <div className="space-y-2.5 border-t border-white/10 p-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => diagnoseContainer(attached)}
                    disabled={busy === 'diagnose'}
                    className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-lavender px-4 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Stethoscope className="h-4 w-4" aria-hidden />
                    {busy === 'diagnose' ? 'Recording…' : 'Diagnose these logs'}
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-canvas/60">
                  Diagnose records one incident (deduplicated by fingerprint). The
                  diagnosis appears in the panel on the right.
                </p>
              </div>
            </div>
          )}
        </section>
        </div>

        {/* RIGHT: incident diagnostic */}
        <section
          className="overflow-hidden rounded-xl border border-hairline bg-panel lg:sticky lg:top-24"
          data-tour="console-diagnose"
          aria-label="Incident diagnostic"
        >
          <div className="border-b border-hairline/80 bg-abyss/60 px-4 py-3">
            <h2 className="text-sm font-medium text-ink">Diagnostic</h2>
            <h2 className="mt-0.5 text-sm font-semibold tracking-tight text-ink">
              {madeIncident ? (
                <>Incident · <span className="font-mono text-[13px]">{madeIncident.title}</span></>
              ) : (
                'No incident recorded yet'
              )}
            </h2>
          </div>
          <div className="space-y-3 p-4">
            {!madeIncident ? (
              <>
                <p className="text-sm leading-relaxed text-muted">
                  Diagnose a log tail on the left and the incident lands here — with its
                  AI investigation and downloadable report. Nothing runs until you ask.
                </p>
                <p className="text-[11px] leading-relaxed text-muted">
                  states: recorded → investigating → completed / failed
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/incidents/${madeIncident.id}`}
                    className="font-mono text-xs text-emerald-300 underline-offset-4 hover:underline"
                  >
                    Open incident →
                  </Link>
                  <span className="font-mono text-[11px] text-muted">
                    {historyActive
                      ? 'investigation running…'
                      : history.data && history.data.length > 0
                        ? `${history.data.length} attempt${history.data.length === 1 ? '' : 's'}`
                        : 'no investigations yet'}
                  </span>
                  <button
                    type="button"
                    onClick={() => runInvestigation(madeIncident.id)}
                    disabled={busy === 'investigate' || historyActive}
                    className="ml-auto flex min-h-[40px] cursor-pointer items-center rounded-xl bg-lavender px-3.5 py-2 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lavender-deep active:bg-press-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'investigate'
                      ? 'Starting…'
                      : `Investigate · ${shortModel(effectiveModel) || 'default'}`}
                  </button>
                </div>
                {history.isLoading ? (
                  <p className="text-sm text-muted">Loading investigation history…</p>
                ) : history.isError ? (
                  <p role="alert" className="text-sm text-amber-300">
                    Could not load investigation history.{' '}
                    <button type="button" onClick={() => history.refetch()} className="underline">
                      Retry
                    </button>
                  </p>
                ) : (history.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">
                    Recorded. Press Investigate to run the AI with the engine shown above —
                    free models only.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {(history.data ?? []).map((inv) => (
                      <InvestigationCard
                        key={inv.id}
                        investigation={inv}
                        expanded
                        nowMs={nowMs}
                        onToggle={() => undefined}
                        onCiteEvidence={handleCiteEvidence}
                      />
                    ))}
                  </ul>
                )}
                <p className="text-[11px] leading-relaxed text-muted">
                  Investigation runs explicitly with the engine shown above — free models
                  only. Completed reports download as .docx.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
