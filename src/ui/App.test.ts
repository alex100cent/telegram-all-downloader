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
