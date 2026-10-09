import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const sendMessage =
    vi.fn<
      (message: {
        scope: string;
        type: string;
        id?: string;
        settings?: Settings;
      }) => Promise<unknown>
    >();

  beforeEach(() => {
    vi.useFakeTimers();
    jobs = [];
    settings = { ...DEFAULT_SETTINGS, language: 'en' };
    sendMessage.mockReset();
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'list')
        return { ok: true, jobs, settings, connections: [{ tabId: 7, client: 'a', ready: true }] };
      if (message.type === 'settings' && message.settings) settings = message.settings;
      return { ok: true };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
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

  async function render() {
    await act(async () => root.render(createElement(App)));
  }

  async function click(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === label || element.getAttribute('aria-label') === label,
    );
    if (!button) throw new Error(`Button missing: ${label}`);
    await act(async () => button.click());
  }

  it('shows a useful empty state without a fictional donation link', async () => {
    await render();
    expect(container.textContent).toContain('Save something worth keeping');
    expect(container.querySelector<HTMLAnchorElement>('.primary-button')?.href).toBe(
      'https://web.telegram.org/a/',
    );
    expect(container.querySelector('.donation-card')).toBeNull();
    expect(container.textContent).toContain('Web A');
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
});
