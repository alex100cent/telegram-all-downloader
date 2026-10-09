import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILD } from '../build';
import { DONATION_URL, REPOSITORY_URL } from '../config';
import type { ErrorCode } from '../domain/errors';
import { ACTIVE_STATES, DEFAULT_SETTINGS, type JobRecord, type Settings } from '../domain/jobs';
import type { MediaKind, TelegramClient } from '../domain/media';
import { errorMessages, messages, resolveLanguage, type Language } from '../i18n';
import { detectBrowser, diagnosticsReport } from './diagnostics';
import { formatBytes, formatTimestamp, jobProgress } from './format';
import { Icon, type IconName } from './Icon';

interface Snapshot {
  jobs: JobRecord[];
  settings: Settings;
  connections: Array<{ tabId: number; client: TelegramClient; ready: boolean }>;
}

type Action =
  | { type: 'cancel' | 'retry' | 'open_source'; id: string }
  | { type: 'clear_history' }
  | { type: 'settings'; settings: Settings };
type ListReply = ({ ok: true } & Snapshot) | { ok: false; error?: string };
type ActionReply = { ok: boolean; error?: string };

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
}: {
  job: JobRecord;
  language: Language;
  browser: string;
  disabled: boolean;
  onAction: (action: Action) => void;
}) {
  const t = messages[language];
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
        <div className={`media-icon media-${job.media.kind}`}>
          <Icon name={mediaIcons[job.media.kind]} />
        </div>
        <div className="job-heading">
          <h3 title={job.media.filename}>{job.media.filename}</h3>
          <div className="job-meta">
            <span>{t.kinds[job.media.kind]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {active ? formatBytes(job.bytes, language) : formatTimestamp(job.updatedAt, language)}
            </span>
            {active && total !== undefined && <span>/ {formatBytes(total, language)}</span>}
          </div>
        </div>
        {canCancel && (
          <button
            className="icon-button cancel-button"
            type="button"
            title={t.cancel}
            aria-label={`${t.cancel}: ${job.media.filename}`}
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
            aria-label={job.media.filename}
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
              aria-label={`${t.source}: ${job.media.filename}`}
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

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [unavailable, setUnavailable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [browser, setBrowser] = useState(navigator.userAgent);
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
  }, [language, settings.theme]);

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
          <p>{t.tagline}</p>
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
                <option value="auto">{t.autoLanguage}</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
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

        {snapshot && !hasJobs && (
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

        {active.length > 0 && (
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
              {active.map((job) => (
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
            <p className="section-hint">{t.keepTabOpen}</p>
          </section>
        )}

        {history.length > 0 && (
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
              {history.map((job) => (
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
            {history.some((job) => ['failed', 'cancelled', 'interrupted'].includes(job.state)) && (
              <p className="section-hint">{t.retryHint}</p>
            )}
          </section>
        )}
      </main>

      <footer className="app-footer">
        {DONATION_URL && (
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
