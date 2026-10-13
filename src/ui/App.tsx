import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILD } from '../build';
import { DONATION_URL, REPOSITORY_URL } from '../config';
import { pendingDonationMilestone, type DonationState } from '../domain/donations';
import type { ErrorCode } from '../domain/errors';
import {
  ACTIVE_STATES,
  DEFAULT_SETTINGS,
  type JobRecord,
  type JobState,
  type Settings,
} from '../domain/jobs';
import type { MediaKind, TelegramClient } from '../domain/media';
import { errorMessages, messages, resolveLanguage, type Language } from '../i18n';
import { detectBrowser, diagnosticsReport } from './diagnostics';
import { formatBytes, formatTimestamp, jobProgress } from './format';
import { Icon, type IconName } from './Icon';

interface Snapshot {
  jobs: JobRecord[];
  settings: Settings;
  donation?: DonationState;
  connections: Array<{ tabId: number; client: TelegramClient; ready: boolean }>;
}

type Action =
  | { type: 'cancel' | 'retry' | 'open_source'; id: string }
  | { type: 'batch_action'; action: 'cancel' | 'retry'; ids: string[] }
  | { type: 'open_batch'; tabId: number }
  | { type: 'clear_history' }
  | { type: 'dismiss_donation'; milestone: number }
  | { type: 'disable_donation_reminders' }
  | { type: 'settings'; settings: Settings };
type ListReply = ({ ok: true } & Snapshot) | { ok: false; error?: string };
type ActionReply = { ok: boolean; error?: string; accepted?: number; rejected?: number };

const ISSUE_URL = `${REPOSITORY_URL}/issues/new?template=bug_report.md`;

const mediaIcons: Record<MediaKind, IconName> = {
  photo: 'photo',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  'round-video': 'video',
  animation: 'video',
  document: 'file',
  sticker: 'sticker',
};

function Diagnostics({
  job,
  language,
  browser,
}: {
  job: JobRecord;
  language: Language;
  browser: string;
}) {
  const t = messages[language];
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const report = useRef<HTMLPreElement>(null);
  const text = diagnosticsReport(job, browser);
  const code = job.state === 'interrupted' ? 'interrupted' : (job.error ?? 'unknown');

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy('copied');
    } catch {
      if (report.current) getSelection()?.selectAllChildren(report.current);
      setCopy('manual');
    }
  }

  return (
    <div className="job-diagnostics">
      <div className="diagnostics-row">
        <span className="error-code">
          {t.errorCode}: <code>{code}</code>
        </span>
        <button
          className="text-button"
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setCopy('idle');
          }}
        >
          {open ? t.hideDiagnostics : t.diagnostics}
        </button>
      </div>
      {open && (
        <div className="diagnostics-panel">
          <pre ref={report} tabIndex={0} aria-label={t.diagnostics}>
            {text}
          </pre>
          <p className="diagnostics-hint">{t.diagnosticsPrivacy}</p>
          <div className="diagnostics-actions">
            <button className="text-button" type="button" onClick={() => void copyReport()}>
              {copy === 'copied' ? t.copied : t.copyDiagnostics}
            </button>
            <a href={ISSUE_URL} target="_blank" rel="noreferrer">
              {t.reportIssue}
              <Icon name="external" width="12" height="12" />
            </a>
          </div>
          {copy === 'manual' && (
            <p className="diagnostics-hint" role="status">
              {t.copyManually}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  language,
  browser,
  disabled,
  onAction,
  selection,
  batchName,
}: {
  job: JobRecord;
  language: Language;
  browser: string;
  disabled: boolean;
  onAction: (action: Action) => void;
  selection?: { checked: boolean; disabled: boolean; toggle: () => void };
  batchName?: string;
}) {
  const t = messages[language];
  const filename = job.destinationName ?? job.media.filename;
  const active = ACTIVE_STATES.includes(job.state);
  const canCancel = job.state === 'queued' || job.state === 'downloading';
  const canRetry = ['failed', 'cancelled', 'interrupted'].includes(job.state);
  const { total, percent } = jobProgress(job);
  const error =
    job.state === 'interrupted'
      ? t.interruptedHint
      : job.error
        ? errorMessages[language][job.error]
        : undefined;
  const statusClass =
    job.state === 'completed'
      ? 'success'
      : ['failed', 'interrupted'].includes(job.state)
        ? 'failure'
        : active
          ? 'active'
          : 'muted';

  return (
    <li className={`job-card ${active ? 'job-active' : ''}`}>
      <div className="job-top">
        {selection && (
          <input
            className="job-select"
            type="checkbox"
            aria-label={`${t.selectFile}: ${filename}`}
            checked={selection.checked}
            disabled={selection.disabled}
            onChange={selection.toggle}
          />
        )}
        <div className={`media-icon media-${job.media.kind}`}>
          <Icon name={mediaIcons[job.media.kind]} />
        </div>
        <div className="job-heading">
          <h3 title={filename}>{filename}</h3>
          <div className="job-meta">
            <span>{t.kinds[job.media.kind]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {active ? formatBytes(job.bytes, language) : formatTimestamp(job.updatedAt, language)}
            </span>
            {active && total !== undefined && <span>/ {formatBytes(total, language)}</span>}
            {batchName && <span className="job-batch">{batchName}</span>}
          </div>
        </div>
        {canCancel && (
          <button
            className="icon-button cancel-button"
            type="button"
            title={t.cancel}
            aria-label={`${t.cancel}: ${filename}`}
            disabled={disabled}
            onClick={() => onAction({ type: 'cancel', id: job.id })}
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      {active && (
        <div className="progress-area">
          <div
            className={`progress-track ${percent === undefined ? 'indeterminate' : ''}`}
            role="progressbar"
            aria-label={filename}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
          </div>
          <div className="progress-caption">
            <span>{t.states[job.state]}</span>
            <span>{percent !== undefined ? `${percent}%` : t.downloadingUnknown}</span>
          </div>
        </div>
      )}

      {!active && (
        <div className="job-bottom">
          <span className={`job-status ${statusClass}`}>
            {job.state === 'completed' && <Icon name="check" width="13" height="13" />}
            {t.states[job.state]}
            {job.state === 'completed' && (
              <span className="saved-size">· {formatBytes(job.bytes, language)}</span>
            )}
          </span>
          <div className="job-actions">
            {canRetry && (
              <button
                className="text-button retry-button"
                type="button"
                title={t.retryHint}
                disabled={disabled}
                onClick={() => onAction({ type: 'retry', id: job.id })}
              >
                <Icon name="retry" width="13" height="13" />
                {t.retry}
              </button>
            )}
            <button
              className="icon-button source-button"
              type="button"
              title={t.source}
              aria-label={`${t.source}: ${filename}`}
              disabled={disabled}
              onClick={() => onAction({ type: 'open_source', id: job.id })}
            >
              <Icon name="external" width="14" height="14" />
            </button>
          </div>
        </div>
      )}
      {!active && error && <p className="job-error">{error}</p>}
      {(job.state === 'failed' || job.state === 'interrupted') && (
        <Diagnostics job={job} language={language} browser={browser} />
      )}
    </li>
  );
}

function ManagerPanel({
  jobs,
  language,
  browser,
  pending,
  onAction,
}: {
  jobs: JobRecord[];
  language: Language;
  browser: string;
  pending: boolean;
  onAction: (action: Action) => void;
}) {
  const t = messages[language];
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<MediaKind | ''>('');
  const [state, setState] = useState<JobState | 'active' | ''>('');
  const [batch, setBatch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const sorted = [...jobs].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const batches = new Map<string, { label: string; count: number }>();
  for (const job of sorted) {
    if (!job.batchId) continue;
    const existing = batches.get(job.batchId);
    if (existing) existing.count++;
    else
      batches.set(job.batchId, {
        label: job.batchLabel ?? `${t.batch} ${batches.size + 1}`,
        count: 1,
      });
  }
  const batchJobs = sorted.filter(
    (job) => !batch || (batch === 'individual' ? !job.batchId : job.batchId === batch.slice(6)),
  );
  const query = search.trim().toLocaleLowerCase(language);
  const filtered = batchJobs.filter(
    (job) =>
      (!kind || job.media.kind === kind) &&
      (!state || (state === 'active' ? ACTIVE_STATES.includes(job.state) : job.state === state)) &&
      (!query ||
        [job.destinationName, job.media.filename].some((name) =>
          name?.toLocaleLowerCase(language).includes(query),
        )),
  );
  const selected = filtered.filter((job) => selection.has(job.id));
  const selectedIds = new Set(selected.map((job) => job.id));
  const cancellable = selected.filter(
    (job) => job.state === 'queued' || job.state === 'downloading',
  );
  const retryable = selected.filter((job) =>
    ['failed', 'cancelled', 'interrupted'].includes(job.state),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const pageSelected = visible.length > 0 && visible.every((job) => selectedIds.has(job.id));
  const canSelectPage =
    selected.length + visible.filter((job) => !selectedIds.has(job.id)).length <= 200;
  const summary = [
    {
      key: 'active',
      label: t.downloads,
      count: batchJobs.filter((job) => ACTIVE_STATES.includes(job.state)).length,
    },
    ...(['completed', 'failed', 'cancelled', 'interrupted', 'skipped'] as const).map((status) => ({
      key: status,
      label: t.states[status],
      count: batchJobs.filter((job) => job.state === status).length,
    })),
  ];

  function resetSelection() {
    setPage(0);
    setSelection(new Set());
  }
  function resetFilters() {
    setSearch('');
    setKind('');
    setState('');
    setBatch('');
    resetSelection();
  }
  function toggleJob(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else if (next.size < 200) next.add(id);
    setSelection(next);
  }
  function togglePage() {
    const next = new Set(selectedIds);
    if (pageSelected) visible.forEach((job) => next.delete(job.id));
    else if (canSelectPage) visible.forEach((job) => next.add(job.id));
    setSelection(next);
  }

  return (
    <section className="manager-panel" aria-labelledby="manager-title">
      <div className="manager-heading">
        <div>
          <h2 id="manager-title">{t.manager}</h2>
          <p>{t.managerHint}</p>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={pending || !jobs.some((job) => !ACTIVE_STATES.includes(job.state))}
          onClick={() => onAction({ type: 'clear_history' })}
        >
          {t.clearHistory}
        </button>
      </div>
      <div className="manager-filters">
        <label className="search-filter" htmlFor="manager-search">
          {t.searchFiles}
          <input
            id="manager-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetSelection();
            }}
          />
        </label>
        <label htmlFor="manager-kind">
          {t.mediaType}
          <select
            id="manager-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as MediaKind | '');
              resetSelection();
            }}
          >
            <option value="">{t.allKinds}</option>
            {Object.entries(t.kinds).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="manager-state">
          {t.jobState}
          <select
            id="manager-state"
            value={state}
            onChange={(event) => {
              setState(event.target.value as JobState | 'active' | '');
              resetSelection();
            }}
          >
            <option value="">{t.allStates}</option>
            <option value="active">{t.downloads}</option>
            {Object.entries(t.states).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="manager-batch">
          {t.batch}
          <select
            id="manager-batch"
            value={batch}
            onChange={(event) => {
              setBatch(event.target.value);
              resetSelection();
            }}
          >
            <option value="">{t.allBatches}</option>
            <option value="individual">{t.noBatch}</option>
            {[...batches].map(([id, info]) => (
              <option value={`batch:${id}`} key={id}>
                {info.label} ({info.count})
              </option>
            ))}
            {batch.startsWith('batch:') && !batches.has(batch.slice(6)) && (
              <option value={batch}>{t.batch} (0)</option>
            )}
          </select>
        </label>
      </div>
      <section className="batch-summary" aria-label={t.batchSummary}>
        <dl>
          {summary.map((item) => (
            <div key={item.key} data-state={item.key}>
              <dt>{item.label}</dt>
              <dd>{item.count}</dd>
            </div>
          ))}
        </dl>
        <p>{t.batchSummaryHint}</p>
      </section>
      <div className="selection-toolbar">
        <div className="selection-controls">
          <button
            className="secondary-button"
            type="button"
            disabled={pending || !visible.length || (!pageSelected && !canSelectPage)}
            onClick={togglePage}
          >
            {pageSelected ? t.deselectPage : t.selectPage}
          </button>
          <span className="selection-count">
            {t.selected}: {selected.length} / 200
          </span>
          {selected.length > 0 && (
            <button
              className="text-button"
              type="button"
              disabled={pending}
              onClick={() => setSelection(new Set())}
            >
              {t.clearSelection}
            </button>
          )}
        </div>
        <div className="bulk-actions">
          <button
            className="secondary-button"
            type="button"
            aria-label={t.cancelSelected}
            disabled={pending || !cancellable.length}
            onClick={() =>
              onAction({
                type: 'batch_action',
                action: 'cancel',
                ids: cancellable.map((job) => job.id),
              })
            }
          >
            {t.cancelSelected} <span>({cancellable.length})</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            aria-label={t.retrySelected}
            disabled={pending || !retryable.length}
            onClick={() =>
              onAction({
                type: 'batch_action',
                action: 'retry',
                ids: retryable.map((job) => job.id),
              })
            }
          >
            {t.retrySelected} <span>({retryable.length})</span>
          </button>
        </div>
        <p>
          {t.selectionHint} {t.bulkHint}
        </p>
      </div>
      <div className="manager-results-heading">
        <span>
          {t.matchingFiles}: {filtered.length}
        </span>
        {(search || kind || state || batch) && (
          <button className="text-button" type="button" onClick={resetFilters}>
            {t.resetFilters}
          </button>
        )}
      </div>
      {visible.length ? (
        <ul className="job-list manager-jobs">
          {visible.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              language={language}
              browser={browser}
              disabled={pending}
              onAction={onAction}
              batchName={job.batchId ? batches.get(job.batchId)?.label : t.noBatch}
              selection={{
                checked: selectedIds.has(job.id),
                disabled: pending || (!selectedIds.has(job.id) && selected.length >= 200),
                toggle: () => toggleJob(job.id),
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="manager-empty">{t.noMatches}</p>
      )}
      <nav className="manager-pagination" aria-label={t.page}>
        <label htmlFor="manager-page-size">
          {t.perPage}
          <select
            id="manager-page-size"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t.page} {currentPage + 1} / {pageCount}
        </span>
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t.previousPage}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            {t.nextPage}
          </button>
        </div>
      </nav>
      {jobs.some((job) => ACTIVE_STATES.includes(job.state)) && (
        <p className="section-hint">{t.keepTabOpen}</p>
      )}
    </section>
  );
}

export function App({ mode = 'popup' }: { mode?: 'popup' | 'manager' }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [unavailable, setUnavailable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [browser, setBrowser] = useState(navigator.userAgent);
  const [selectedTab, setSelectedTab] = useState<number>();
  const mounted = useRef(false);
  const loading = useRef(false);
  const actionPending = useRef(false);
  const settings = snapshot?.settings ?? DEFAULT_SETTINGS;
  const language = resolveLanguage(settings.language);
  const t = messages[language];

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response: ListReply = await chrome.runtime.sendMessage({
        scope: 'tad-ui',
        type: 'list',
      });
      if (!response?.ok) throw new Error('List unavailable');
      if (mounted.current) {
        setSnapshot({
          jobs: response.jobs,
          settings: response.settings,
          donation: response.donation,
          connections: response.connections,
        });
        setUnavailable(false);
      }
    } catch {
      if (mounted.current) setUnavailable(true);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void detectBrowser().then((value) => {
      if (mounted.current) setBrowser(value);
    });
    void refresh();
    const timer = window.setInterval(() => {
      if (!actionPending.current) void refresh();
    }, 1_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.view = mode;
  }, [language, settings.theme, mode]);

  async function execute(action: Action) {
    if (actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setNotice(undefined);
    try {
      const response: ActionReply = await chrome.runtime.sendMessage({
        scope: 'tad-ui',
        ...action,
      });
      if (!mounted.current) return;
      if (
        action.type === 'batch_action' &&
        typeof response?.accepted === 'number' &&
        typeof response.rejected === 'number'
      ) {
        const nextStep =
          response.accepted > 0 && action.action === 'retry' ? ` ${t.batchRetryNotice}` : '';
        const rejectedHint = response.rejected > 0 ? ` ${t.batchActionRejectedHint}` : '';
        setNotice({
          text: `${t.batchActionAccepted}: ${response.accepted}. ${t.batchActionRejected}: ${response.rejected}.${nextStep}${rejectedHint}`,
          error: response.rejected > 0,
        });
        await refresh();
        return;
      }
      if (!response?.ok) {
        if (action.type === 'cancel' && response?.error === 'finalizing') {
          setNotice({ text: t.states.finalizing, error: false });
          await refresh();
          return;
        }
        const message = response?.error
          ? errorMessages[language][response.error as ErrorCode]
          : undefined;
        setNotice({ text: message ?? t.operationFailed, error: true });
      } else {
        if (action.type === 'settings')
          setSnapshot((previous) =>
            previous ? { ...previous, settings: action.settings } : previous,
          );
        if (action.type === 'retry') setNotice({ text: t.retryNotice, error: false });
        if (action.type === 'open_batch') setNotice({ text: t.batchNotice, error: false });
        if (action.type === 'batch_action' && action.action === 'retry')
          setNotice({ text: t.batchRetryNotice, error: false });
        if (action.type === 'open_source') setNotice({ text: t.sourceNotice, error: false });
        await refresh();
      }
    } catch {
      if (mounted.current) setNotice({ text: t.operationFailed, error: true });
    } finally {
      actionPending.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const active =
    snapshot?.jobs
      .filter((job) => ACTIVE_STATES.includes(job.state))
      .sort((a, b) => a.createdAt - b.createdAt) ?? [];
  const history =
    snapshot?.jobs
      .filter((job) => !ACTIVE_STATES.includes(job.state))
      .sort((a, b) => b.updatedAt - a.updatedAt) ?? [];
  const connectedClients = [
    ...new Set(
      snapshot?.connections
        .filter((connection) => connection.ready)
        .map((connection) => connection.client) ?? [],
    ),
  ].sort();
  const hasConnection = connectedClients.length > 0;
  const hasJobs = active.length > 0 || history.length > 0;
  const readyTabs = snapshot?.connections.filter((connection) => connection.ready) ?? [];
  const batchTab =
    readyTabs.find((connection) => connection.tabId === selectedTab)?.tabId ?? readyTabs[0]?.tabId;
  const managerUrl = chrome.runtime.getURL('manager.html');
  const donationMilestone = snapshot?.donation
    ? pendingDonationMilestone(snapshot.donation)
    : undefined;
  const showDonationReminder =
    Boolean(DONATION_URL) &&
    settings.donationReminders &&
    donationMilestone !== undefined &&
    !settingsOpen &&
    !unavailable;
  const changeSettings = (patch: Partial<Settings>) => {
    void execute({ type: 'settings', settings: { ...settings, ...patch } });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-icon">
          <Icon name="download" width="23" height="23" />
        </div>
        <div className="brand">
          <h1>
            Telegram <span>All Downloader</span>
          </h1>
          <p>{mode === 'manager' ? t.manager : t.tagline}</p>
        </div>

        <button
          className={`icon-button settings-button ${settingsOpen ? 'selected' : ''}`}
          type="button"
          title={settingsOpen ? t.closeSettings : t.settings}
          aria-label={settingsOpen ? t.closeSettings : t.settings}
          aria-expanded={settingsOpen}
          aria-controls="settings-panel"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Icon name={settingsOpen ? 'close' : 'settings'} />
        </button>
      </header>

      <main>
        <div className={`connection ${hasConnection ? 'connection-ready' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />
          <span>
            {hasConnection
              ? t.connected
              : snapshot?.connections.length
                ? t.waitingConnection
                : t.noConnection}
          </span>
          {connectedClients.map((client) => (
            <span className="client-chip" key={client}>
              Web {client.toUpperCase()}
            </span>
          ))}
        </div>

        <div className="download-launcher">
          {readyTabs.length > 1 && (
            <label htmlFor="batch-tab">
              {t.chooseTab}
              <select
                id="batch-tab"
                value={batchTab}
                onChange={(event) => setSelectedTab(Number(event.target.value))}
              >
                {readyTabs.map((connection) => (
                  <option key={connection.tabId} value={connection.tabId}>
                    Web {connection.client.toUpperCase()} · {t.browserTab} {connection.tabId}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="launcher-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={pending || batchTab === undefined}
              onClick={() => {
                if (batchTab !== undefined) void execute({ type: 'open_batch', tabId: batchTab });
              }}
            >
              <Icon name="download" width="15" height="15" />
              {t.chooseFiles}
            </button>
            {mode === 'popup' && (
              <a className="manager-link" href={managerUrl} target="_blank" rel="noreferrer">
                {t.manager}
                <Icon name="external" width="12" height="12" />
              </a>
            )}
          </div>
          <p>{t.batchHint}</p>
        </div>

        {settingsOpen && (
          <section className="settings-panel" id="settings-panel" aria-labelledby="settings-title">
            <h2 id="settings-title">{t.settings}</h2>
            <label className="setting-row" htmlFor="language">
              <span>{t.language}</span>
              <select
                id="language"
                value={settings.language}
                disabled={pending || !snapshot}
                onChange={(event) =>
                  changeSettings({ language: event.target.value as Settings['language'] })
                }
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="auto">{t.autoLanguage}</option>
              </select>
            </label>
            <label className="setting-row" htmlFor="theme">
              <span>{t.theme}</span>
              <select
                id="theme"
                value={settings.theme}
                disabled={pending || !snapshot}
                onChange={(event) =>
                  changeSettings({ theme: event.target.value as Settings['theme'] })
                }
              >
                <option value="system">{t.systemTheme}</option>
                <option value="light">{t.lightTheme}</option>
                <option value="dark">{t.darkTheme}</option>
              </select>
            </label>
            <label className="history-setting" htmlFor="keep-history">
              <span>{t.keepHistory}</span>
              <input
                id="keep-history"
                type="checkbox"
                checked={settings.keepHistory}
                disabled={pending || !snapshot}
                onChange={(event) => changeSettings({ keepHistory: event.target.checked })}
                aria-describedby="history-hint"
              />
            </label>
            <p className="setting-hint" id="history-hint">
              {t.historyHint}
            </p>
            <label className="history-setting donation-setting" htmlFor="donation-reminders">
              <span>{t.donationReminders}</span>
              <input
                id="donation-reminders"
                type="checkbox"
                checked={settings.donationReminders}
                disabled={pending || !snapshot}
                onChange={(event) => changeSettings({ donationReminders: event.target.checked })}
                aria-describedby="donation-hint"
              />
            </label>
            <p className="setting-hint" id="donation-hint">
              {t.donationRemindersHint}
            </p>
            <div className="about-build" role="group" aria-labelledby="about-title">
              <h3 id="about-title">{t.aboutBuild}</h3>
              <dl>
                <div>
                  <dt>{t.version}</dt>
                  <dd>{BUILD.version}</dd>
                </div>
                <div>
                  <dt>{t.build}</dt>
                  <dd>
                    <code>{BUILD.id}</code>
                  </dd>
                </div>
              </dl>
              <p className="setting-hint">
                {BUILD.commit
                  ? BUILD.modified
                    ? t.buildModified
                    : t.buildClean
                  : t.buildUnversioned}{' '}
                {BUILD.ciRun ? `${t.ciBuild} #${BUILD.ciRun}.` : `${t.localBuild}.`}
              </p>
            </div>
          </section>
        )}

        {unavailable && (
          <div className="notice notice-error" role="alert">
            <span>{t.unavailable}</span>
            <button className="text-button" type="button" onClick={() => void refresh()}>
              {t.refresh}
            </button>
          </div>
        )}
        {notice && (
          <div
            className={`notice ${notice.error ? 'notice-error' : ''}`}
            role={notice.error ? 'alert' : 'status'}
          >
            <span>{notice.text}</span>
            <button
              className="icon-button"
              type="button"
              aria-label={t.closeNotice}
              onClick={() => setNotice(undefined)}
            >
              <Icon name="close" width="14" height="14" />
            </button>
          </div>
        )}

        {!snapshot && !unavailable && (
          <p className="loading-state" role="status">
            {t.loading}
          </p>
        )}

        {showDonationReminder && donationMilestone !== undefined && (
          <aside className="donation-reminder" aria-labelledby="donation-title">
            <div className="donation-heading">
              <Icon name="coffee" width="18" height="18" />
              <h2 id="donation-title">{t.donate}</h2>
            </div>
            <p>{t.donationMessage}</p>
            <div className="donation-actions">
              <a
                className="secondary-button"
                href={DONATION_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  void execute({ type: 'dismiss_donation', milestone: donationMilestone })
                }
              >
                {t.donationAction}
                <Icon name="external" width="12" height="12" />
              </a>
              <button
                className="text-button"
                type="button"
                disabled={pending}
                onClick={() =>
                  void execute({ type: 'dismiss_donation', milestone: donationMilestone })
                }
              >
                {t.donationNotNow}
              </button>
              <button
                className="text-button donation-never"
                type="button"
                disabled={pending}
                onClick={() => void execute({ type: 'disable_donation_reminders' })}
              >
                {t.donationNever}
              </button>
            </div>
          </aside>
        )}

        {snapshot && !hasJobs && mode === 'popup' && (
          <section className="empty-state">
            <div className="empty-art" aria-hidden="true">
              <span className="empty-art-orbit" />
              <span className="empty-art-file">
                <Icon name="file" width="42" height="42" />
              </span>
              <span className="empty-art-download">
                <Icon name="download" width="21" height="21" />
              </span>
            </div>
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyHint}</p>
            <a
              className="primary-button"
              href="https://web.telegram.org/a/"
              target="_blank"
              rel="noreferrer"
            >
              {t.openTelegram}
              <Icon name="external" width="14" height="14" />
            </a>
            {!hasConnection && <p className="empty-connection-hint">{t.connectionHint}</p>}
          </section>
        )}

        {snapshot && mode === 'manager' && (
          <ManagerPanel
            jobs={snapshot.jobs}
            language={language}
            browser={browser}
            pending={pending}
            onAction={(action) => void execute(action)}
          />
        )}

        {mode === 'popup' && active.length > 0 && (
          <section className="jobs-section" aria-labelledby="active-title">
            <div className="section-heading">
              <h2 id="active-title">
                {t.downloads}
                <span className="count">{active.length}</span>
              </h2>
              <span className="activity-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
            <ul className="job-list">
              {active.slice(0, 5).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  language={language}
                  browser={browser}
                  disabled={pending}
                  onAction={(action) => void execute(action)}
                />
              ))}
            </ul>
            {active.length > 5 && (
              <a className="more-downloads" href={managerUrl} target="_blank" rel="noreferrer">
                {t.popupMore} ({active.length})
              </a>
            )}
            <p className="section-hint">{t.keepTabOpen}</p>
          </section>
        )}

        {mode === 'popup' && history.length > 0 && (
          <section className="jobs-section history-section" aria-labelledby="history-title">
            <div className="section-heading">
              <h2 id="history-title">
                {t.history}
                <span className="count">{history.length}</span>
              </h2>
              <button
                className="text-button clear-button"
                type="button"
                disabled={pending}
                onClick={() => void execute({ type: 'clear_history' })}
              >
                {t.clearHistory}
              </button>
            </div>
            <ul className="job-list">
              {history.slice(0, 5).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  language={language}
                  browser={browser}
                  disabled={pending}
                  onAction={(action) => void execute(action)}
                />
              ))}
            </ul>
            {history.length > 5 && (
              <a className="more-downloads" href={managerUrl} target="_blank" rel="noreferrer">
                {t.popupMore} ({history.length})
              </a>
            )}
            {history.some((job) => ['failed', 'cancelled', 'interrupted'].includes(job.state)) && (
              <p className="section-hint">{t.retryHint}</p>
            )}
          </section>
        )}
      </main>

      <footer className="app-footer">
        {DONATION_URL && !showDonationReminder && (
          <a className="donation-card" href={DONATION_URL} target="_blank" rel="noreferrer">
            <Icon name="coffee" width="23" height="23" />
            <span>
              <strong>{t.donate}</strong>
              <small>{t.donateHint}</small>
            </span>
            <Icon name="external" width="14" height="14" />
          </a>
        )}
        <div className="footer-links">
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            {t.help}
            <Icon name="external" width="12" height="12" />
          </a>
          <a href={ISSUE_URL} target="_blank" rel="noreferrer">
            {t.reportIssue}
          </a>
        </div>
        <p>{t.localHint}</p>
      </footer>
    </div>
  );
}
