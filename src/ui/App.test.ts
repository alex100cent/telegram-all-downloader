import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DONATION_URL } from '../config';
import type { DonationState } from '../domain/donations';
import { DEFAULT_SETTINGS, type JobRecord, type Settings } from '../domain/jobs';
import { App } from './App';

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    key: 'media-1',
    state: 'downloading',
    bytes: 1024,
    total: 2048,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tabId: 7,
    sessionId: 'session',
    attempt: 1,
    media: {
      identity: {
        client: 'a',
        accountId: 'user',
        peerId: 'chat',
        messageId: '1',
        mediaId: 'document',
      },
      filename: 'episode.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
    },
    ...overrides,
  };
}

describe('popup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let jobs: JobRecord[];
  let settings: Settings;
  let donation: DonationState | undefined;
  let connections: Array<{ tabId: number; client: 'a' | 'k'; ready: boolean }>;
  let batchResult: { ok: boolean; accepted: number; rejected: number };
  const sendMessage =
    vi.fn<
      (message: {
        scope: string;
        type: string;
        id?: string;
        settings?: Settings;
        ids?: string[];
        action?: 'cancel' | 'retry';
        tabId?: number;
        milestone?: number;
      }) => Promise<unknown>
    >();

  beforeEach(() => {
    vi.useFakeTimers();
    jobs = [];
    settings = { ...DEFAULT_SETTINGS, language: 'en' };
    donation = { completedDownloads: 0, dismissedMilestone: 0 };
    connections = [{ tabId: 7, client: 'a', ready: true }];
    batchResult = { ok: true, accepted: 1, rejected: 0 };
    sendMessage.mockReset();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'list') return { ok: true, jobs, settings, connections, donation };
      if (message.type === 'batch_action') return batchResult;
      if (message.type === 'settings' && message.settings) settings = message.settings;
      if (message.type === 'dismiss_donation' && donation && message.milestone !== undefined)
        donation.dismissedMilestone = message.milestone;
      if (message.type === 'disable_donation_reminders') settings.donationReminders = false;
      return { ok: true };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` },
    });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(mode: 'popup' | 'manager' = 'popup') {
    await act(async () => root.render(createElement(App, { mode })));
  }

  async function choose(id: string, value: string) {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`);
    if (!select) throw new Error(`Select missing: ${id}`);
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function searchFiles(value: string) {
    const input = container.querySelector<HTMLInputElement>('#manager-search');
    if (!input) throw new Error('Search missing');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function filenames() {
    return [...container.querySelectorAll('.manager-jobs h3')].map((node) => node.textContent);
  }

  async function click(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === label || element.getAttribute('aria-label') === label,
    );
    if (!button) throw new Error(`Button missing: ${label}`);
    await act(async () => button.click());
  }

  it('keeps the empty state primary and offers the configured optional support link', async () => {
    await render();
    expect(container.textContent).toContain('Save something worth keeping');
    expect(container.querySelector<HTMLAnchorElement>('.primary-button')?.href).toBe(
      'https://web.telegram.org/a/',
    );
    expect(container.querySelector<HTMLAnchorElement>('.donation-card')?.href).toBe(DONATION_URL);
    expect(container.querySelector('.donation-reminder')).toBeNull();
    expect(container.textContent).toContain('Web A');
  });

  it('shows one inline reminder at a completed-download milestone without opening links or stealing focus', async () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    const focusTarget = document.createElement('button');
    document.body.append(focusTarget);
    focusTarget.focus();
    donation = { completedDownloads: 19, dismissedMilestone: 0 };
    await render();
    expect(container.querySelector('.donation-reminder')).toBeNull();
    donation.completedDownloads = 20;
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    const reminder = container.querySelector('.donation-reminder');
    expect(reminder?.textContent).toContain('Buy the developer a coffee');
    expect(reminder?.textContent).toContain('optional');
    expect(reminder?.querySelector<HTMLAnchorElement>('a')?.href).toBe(DONATION_URL);
    expect(reminder?.querySelector<HTMLAnchorElement>('a')?.rel).toBe('noreferrer');
    expect(container.querySelector('.donation-card')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(focusTarget);
    expect(openWindow).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.every(([message]) => message.type === 'list')).toBe(true);
    focusTarget.remove();
    openWindow.mockRestore();
  });

  it('dismisses only the current milestone and offers the next reminder in the manager', async () => {
    donation = { completedDownloads: 20, dismissedMilestone: 0 };
    await render('manager');
    await click('Not now');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'dismiss_donation',
      milestone: 20,
    });
    expect(container.querySelector('.donation-reminder')).toBeNull();
    expect(container.querySelector('.donation-card')).not.toBeNull();
    donation.completedDownloads = 39;
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.querySelector('.donation-reminder')).toBeNull();
    donation.completedDownloads = 40;
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.querySelectorAll('.donation-reminder')).toHaveLength(1);
    await click('Not now');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'dismiss_donation',
      milestone: 40,
    });
  });

  it('disables reminders globally while retaining the quiet voluntary support link', async () => {
    donation = { completedDownloads: 20, dismissedMilestone: 0 };
    await render();
    await click('Don’t show again');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'disable_donation_reminders',
    });
    expect(container.querySelector('.donation-reminder')).toBeNull();
    donation.completedDownloads = 100;
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.querySelector('.donation-reminder')).toBeNull();
    expect(container.querySelector<HTMLAnchorElement>('.donation-card')?.href).toBe(DONATION_URL);
    await click('Settings');
    expect(container.querySelector<HTMLInputElement>('#donation-reminders')?.checked).toBe(false);
  });

  it('dismisses the reminder on an explicit support-link click', async () => {
    donation = { completedDownloads: 20, dismissedMilestone: 0 };
    await render();
    const link = container.querySelector<HTMLAnchorElement>('.donation-reminder a');
    if (!link) throw new Error('Support link missing');
    link.addEventListener('click', (event) => event.preventDefault());
    await act(async () => link.click());
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'dismiss_donation',
      milestone: 20,
    });
    expect(container.querySelector('.donation-reminder')).toBeNull();
  });

  it('does not derive reminders from history when an older snapshot omits donation state', async () => {
    donation = undefined;
    jobs = Array.from({ length: 20 }, (_, index) =>
      makeJob({ id: `saved-${index}`, state: 'completed' }),
    );
    await render();
    expect(container.querySelector('.donation-reminder')).toBeNull();
    expect(container.querySelector('.donation-card')).not.toBeNull();
  });

  it('keeps reminders out of settings and translates reminder preferences and actions to Russian', async () => {
    settings = { ...DEFAULT_SETTINGS };
    donation = { completedDownloads: 20, dismissedMilestone: 0 };
    await render();
    expect(document.documentElement.lang).toBe('en');
    await click('Settings');
    expect(container.querySelector('.donation-reminder')).toBeNull();
    expect(container.querySelector<HTMLSelectElement>('#language')?.value).toBe('en');
    await choose('language', 'ru');
    expect(container.textContent).toContain('Напоминать о поддержке');
    const reminders = container.querySelector<HTMLInputElement>('#donation-reminders');
    if (!reminders) throw new Error('Reminder setting missing');
    await act(async () => reminders.click());
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'settings',
      settings: { ...DEFAULT_SETTINGS, language: 'ru', donationReminders: false },
    });
    await act(async () => reminders.click());
    await click('Закрыть настройки');
    expect(container.querySelector('.donation-reminder')?.textContent).toContain(
      'Купить кофе разработчику',
    );
    expect(container.querySelector('.donation-reminder')?.textContent).toContain(
      'Больше не показывать',
    );
    await click('Не сейчас');
    expect(container.querySelector('.donation-reminder')).toBeNull();
  });

  it('reports a known percentage and leaves unknown totals indeterminate', async () => {
    jobs = [makeJob(), makeJob({ id: 'job-2', total: undefined })];
    await render();
    const progress = container.querySelectorAll('[role="progressbar"]');
    expect(progress[0]?.getAttribute('aria-valuenow')).toBe('50');
    expect(progress[1]?.hasAttribute('aria-valuenow')).toBe(false);
    expect(container.textContent).toContain('Total size unknown');
    await click('Cancel: episode.mp3');
    expect(sendMessage).toHaveBeenCalledWith({ scope: 'tad-ui', type: 'cancel', id: 'job-1' });
  });

  it('explains recovery and routes retry back to the source tab', async () => {
    jobs = [makeJob({ state: 'failed', error: 'invalid_response' })];
    await render();
    expect(container.textContent).toContain('Telegram returned an incomplete or unexpected file.');
    expect(container.textContent).toContain('Click Save beside the attachment');
    await click('Retry in Telegram');
    expect(sendMessage).toHaveBeenCalledWith({ scope: 'tad-ui', type: 'retry', id: 'job-1' });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Continue in Telegram',
    );
  });

  it('does not offer cancellation while the browser commits the file', async () => {
    jobs = [makeJob({ state: 'finalizing', bytes: 2048 })];
    await render();
    expect(container.textContent).toContain('Saving to disk');
    expect(container.querySelector('.cancel-button')).toBeNull();
    expect(container.textContent).not.toContain('Saved');
  });

  it('persists settings and updates the document language and theme', async () => {
    await render();
    await click('Settings');
    const language = container.querySelector<HTMLSelectElement>('#language');
    if (!language) throw new Error('Language selector missing');
    await act(async () => {
      language.value = 'ru';
      language.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'settings',
      settings: { ...DEFAULT_SETTINGS, language: 'ru' },
    });
    expect(document.documentElement.lang).toBe('ru');
    expect(container.textContent).toContain('Оформление');
    const theme = container.querySelector<HTMLSelectElement>('#theme');
    if (!theme) throw new Error('Theme selector missing');
    await act(async () => {
      theme.value = 'dark';
      theme.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('clears history without cancelling an active job', async () => {
    jobs = [makeJob(), makeJob({ id: 'job-2', state: 'completed' })];
    await render();
    await click('Clear history');
    expect(sendMessage).toHaveBeenCalledWith({ scope: 'tad-ui', type: 'clear_history' });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }));
  });

  it('identifies the running build in settings', async () => {
    await render();
    await click('Settings');
    const about = container.querySelector('.about-build');
    expect(about?.textContent).toContain('Version0.0.0-test');
    expect(about?.textContent).toContain('Buildabc1234');
    expect(about?.textContent).toContain('Built from a commit without local changes. Local build.');
  });

  it('previews and copies failure diagnostics without private identifiers', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Test Browser 1.0');
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    const job = makeJob({
      state: 'failed',
      error: 'disk_error',
      bytes: 3 * 1024 * 1024,
      total: 12 * 1024 * 1024,
      attempt: 2,
      tabId: 9191,
      sessionId: 'session-secret-7',
    });
    job.media = {
      identity: {
        client: 'k',
        accountId: '777000111',
        peerId: '-1009876543210',
        messageId: '4242',
        mediaId: '5555666677778888',
        variant: 'original',
      },
      kind: 'video',
      filename: 'Private Holiday Video.mp4',
      mimeType: 'video/mp4',
      byteSize: 12 * 1024 * 1024,
      sourceUrl: 'https://web.telegram.org/k/#-9876543210?message=4242',
    };
    jobs = [job];
    await render();
    expect(container.querySelector('.error-code')?.textContent).toBe('Code: disk_error');
    await click('Diagnostics');
    const report = container.querySelector('.diagnostics-panel pre')?.textContent ?? '';
    expect(report).toBe(
      [
        'Telegram All Downloader 0.0.0-test, build abc1234, local',
        'Browser: Test Browser 1.0',
        'Telegram: Web K',
        'Attachment: video, video/mp4, 12 MiB',
        'Result: failed, disk_error, 25% transferred, attempt 2',
      ].join('\n'),
    );
    for (const secret of [
      'Private Holiday',
      '777000111',
      '9876543210',
      '4242',
      '5555666677778888',
      'web.telegram.org',
      'session-secret',
      '9191',
    ])
      expect(report).not.toContain(secret);
    await click('Copy diagnostics');
    expect(writeText).toHaveBeenCalledWith(report);
    expect(container.querySelector('.diagnostics-actions button')?.textContent).toBe('Copied');
  });

  it('asks for manual copying when the clipboard is unavailable', async () => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    } as unknown as Clipboard);
    jobs = [makeJob({ state: 'failed', error: 'timeout' })];
    await render();
    await click('Diagnostics');
    await click('Copy diagnostics');
    expect(container.querySelector('.diagnostics-panel [role="status"]')?.textContent).toBe(
      'Select the text above and copy it manually.',
    );
  });

  it('explains an interrupted source tab instead of a missing file', async () => {
    jobs = [makeJob({ state: 'interrupted', error: 'source_unavailable' })];
    await render();
    expect(container.querySelector('.job-error')?.textContent).toBe(
      'The Telegram tab that was saving this file was closed, reloaded or left Telegram. Open the attachment and save it again.',
    );
    expect(container.querySelector('.error-code')?.textContent).toBe('Code: interrupted');
  });

  it('polls only while the popup is mounted', async () => {
    await render();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('links the popup to the full manager and bounds its recent cards', async () => {
    jobs = Array.from({ length: 14 }, (_, index) =>
      makeJob({ id: `job-${index}`, state: index < 7 ? 'downloading' : 'completed' }),
    );
    await render();
    expect(container.querySelector<HTMLAnchorElement>('.manager-link')?.getAttribute('href')).toBe(
      'chrome-extension://test/manager.html',
    );
    expect(container.querySelectorAll('.job-card')).toHaveLength(10);
    expect(container.querySelectorAll('.more-downloads')).toHaveLength(2);
  });

  it('opens the batch selector in the chosen ready Telegram tab', async () => {
    connections = [
      { tabId: 7, client: 'a', ready: true },
      { tabId: 8, client: 'k', ready: true },
      { tabId: 9, client: 'a', ready: false },
    ];
    await render('manager');
    expect(container.querySelectorAll('#batch-tab option')).toHaveLength(2);
    await choose('batch-tab', '8');
    await click('Choose files in Telegram');
    expect(sendMessage).toHaveBeenCalledWith({ scope: 'tad-ui', type: 'open_batch', tabId: 8 });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'select attachments and choose a folder',
    );
    connections = [];
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    const launcher = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Choose files in Telegram',
    );
    expect(launcher?.disabled).toBe(true);
  });

  it('combines manager filename, kind, state and batch filters without hiding batch totals', async () => {
    const audio = makeJob({
      id: 'audio',
      state: 'completed',
      batchId: 'first',
      batchLabel: 'Batch 1',
      destinationName: 'renamed episode.mp3',
    });
    const photo = makeJob({
      id: 'photo',
      state: 'failed',
      batchId: 'first',
      batchLabel: 'Batch 1',
      media: { ...audio.media, kind: 'photo', filename: 'sunset.jpg' },
    });
    jobs = [
      audio,
      photo,
      makeJob({ id: 'other', state: 'skipped', batchId: 'second', batchLabel: 'Batch 2' }),
      makeJob({ id: 'single', state: 'cancelled' }),
    ];
    await render('manager');
    expect(document.documentElement.dataset.view).toBe('manager');
    expect(filenames()).toHaveLength(4);
    await choose('manager-batch', 'batch:first');
    expect(filenames()).toHaveLength(2);
    expect(container.querySelector('.batch-summary [data-state="failed"] dd')?.textContent).toBe(
      '1',
    );
    await choose('manager-kind', 'audio');
    await choose('manager-state', 'completed');
    await searchFiles('RENAMED');
    expect(filenames()).toEqual(['renamed episode.mp3']);
    expect(container.querySelector('.batch-summary [data-state="failed"] dd')?.textContent).toBe(
      '1',
    );
    await searchFiles('not present');
    expect(filenames()).toHaveLength(0);
    expect(container.textContent).toContain('No downloads match these filters.');
    await click('Reset filters');
    expect(filenames()).toHaveLength(4);
    await choose('manager-state', 'skipped');
    expect(filenames()).toEqual(['episode.mp3']);
    expect(container.querySelector('.job-status')?.textContent).toBe('Skipped');
    await choose('manager-state', '');
    await choose('manager-batch', 'individual');
    expect(filenames()).toHaveLength(1);
  });

  it('sends only eligible selected IDs for cancellation and retry, including partial rejection details', async () => {
    const states = [
      'queued',
      'downloading',
      'finalizing',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
      'skipped',
    ] as const;
    jobs = states.map((state) => makeJob({ id: state, state, batchId: 'batch-1' }));
    await render('manager');
    await click('Select page');
    await click('Cancel selected');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'batch_action',
      action: 'cancel',
      ids: ['downloading', 'queued'],
    });
    batchResult = { ok: false, accepted: 2, rejected: 1 };
    await click('Retry selected in Telegram');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'batch_action',
      action: 'retry',
      ids: ['cancelled', 'failed', 'interrupted'],
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Requests accepted: 2. Requests not accepted: 1.',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'choose a folder to retry',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'use Open source message on the file',
    );
    await choose('manager-state', 'failed');
    expect(container.querySelector('.selection-count')?.textContent).toBe('Selected: 0 / 200');
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Retry selected in Telegram"]')
        ?.disabled,
    ).toBe(true);
  });

  it('bounds manager pages and selection to 200, then drops jobs removed by a snapshot', async () => {
    jobs = Array.from({ length: 230 }, (_, index) =>
      makeJob({ id: `job-${index.toString().padStart(3, '0')}`, state: 'failed' }),
    );
    await render('manager');
    expect(container.querySelectorAll('.manager-jobs .job-card')).toHaveLength(25);
    await choose('manager-page-size', '100');
    await click('Select page');
    await click('Next page');
    await click('Select page');
    await click('Next page');
    expect(container.querySelectorAll('.manager-jobs .job-card')).toHaveLength(30);
    expect(container.querySelector('.selection-count')?.textContent).toBe('Selected: 200 / 200');
    expect(
      [...container.querySelectorAll<HTMLInputElement>('.job-select')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    await click('Retry selected in Telegram');
    const request = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'batch_action');
    expect(request?.ids).toHaveLength(200);
    expect(new Set(request?.ids).size).toBe(200);
    jobs = jobs.slice(200);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.querySelector('.selection-count')?.textContent).toBe('Selected: 0 / 200');
    expect(container.querySelector('.manager-pagination')?.textContent).toContain('Page 1 / 1');
  });

  it('uses actual destination names and routes a batch card retry through the recoverable single-job command', async () => {
    jobs = [makeJob({ state: 'failed', batchId: 'batch-1', destinationName: 'episode (2).mp3' })];
    await render('manager');
    expect(filenames()).toEqual(['episode (2).mp3']);
    expect(container.querySelector('.job-select')?.getAttribute('aria-label')).toBe(
      'Select: episode (2).mp3',
    );
    await click('Retry in Telegram');
    expect(sendMessage).toHaveBeenCalledWith({
      scope: 'tad-ui',
      type: 'retry',
      id: 'job-1',
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'choose a folder in the file selector',
    );
    expect(container.querySelector('.batch-summary')?.textContent).toContain(
      'Counts from retained history',
    );
  });

  it('localizes manager controls and skipped outcomes in Russian', async () => {
    settings = { ...settings, language: 'ru', theme: 'dark' };
    jobs = [makeJob({ state: 'skipped', destinationName: 'episode.mp3' })];
    await render('manager');
    expect(container.querySelector('#manager-title')?.textContent).toBe('Менеджер загрузок');
    expect(container.querySelector('.job-status')?.textContent).toBe('Пропущено');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await click('Выбрать страницу');
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Повторить выбранные в Telegram"]')
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Отменить выбранные"]')?.disabled,
    ).toBe(true);
  });
});
