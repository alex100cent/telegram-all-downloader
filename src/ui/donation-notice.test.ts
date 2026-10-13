import { afterEach, describe, expect, it, vi } from 'vitest';
import { DONATION_URL } from '../config';
import { DEFAULT_SETTINGS } from '../domain/jobs';
import { createDonationNotice } from './donation-notice';

const notices: ReturnType<typeof createDonationNotice>[] = [];
const state = (completedDownloads: number, dismissedMilestone = 0) => ({
  completedDownloads,
  dismissedMilestone,
});
const root = () => document.querySelector('[data-tad-donation]')?.shadowRoot;
const button = (label: string) =>
  [...root()!.querySelectorAll('button')].find((element) => element.textContent === label)!;
function create(send = vi.fn(async () => ({ ok: true }))) {
  const notice = createDonationNotice(send);
  notices.push(notice);
  return { notice, send };
}

afterEach(() => {
  notices.splice(0).forEach((notice) => notice.dispose());
  document.body.replaceChildren();
});

describe('Telegram donation notice', () => {
  it('shows only a pending milestone and never changes focus or opens a tab', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const open = vi.spyOn(window, 'open');
    const { notice, send } = create();
    notice.update(state(19), DEFAULT_SETTINGS);
    expect(root()).toBeUndefined();
    notice.update(state(20), DEFAULT_SETTINGS);
    const link = root()!.querySelector('a')!;
    expect(link.href).toBe(DONATION_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    expect(root()!.textContent).toContain('Buy the developer a coffee');
    expect(document.activeElement).toBe(input);
    notice.update(state(21), DEFAULT_SETTINGS);
    expect(root()!.querySelector('a')).toBe(link);
    expect(open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    notice.update(state(21, 20), DEFAULT_SETTINGS);
    expect(root()).toBeUndefined();
    notice.update(state(20), DEFAULT_SETTINGS);
    expect(root()).toBeUndefined();
    notice.update(state(40, 20), { ...DEFAULT_SETTINGS, donationReminders: false });
    expect(root()).toBeUndefined();
  });

  it('dismisses one milestone without swallowing the next one that arrives during the request', async () => {
    let resolve!: (reply: { ok: boolean }) => void;
    const send = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((done) => {
          resolve = done;
        }),
    );
    const { notice } = create(send);
    notice.update(state(20), DEFAULT_SETTINGS);
    button('Not now').click();
    expect(send).toHaveBeenCalledWith({ type: 'dismiss_donation', milestone: 20 });
    notice.update(state(40), DEFAULT_SETTINGS);
    resolve({ ok: true });
    await vi.waitFor(() => expect(button('Not now').disabled).toBe(false));
    expect(root()).toBeDefined();
    button('Not now').click();
    expect(send).toHaveBeenLastCalledWith({ type: 'dismiss_donation', milestone: 40 });
    resolve({ ok: true });
    await vi.waitFor(() => expect(root()).toBeUndefined());
  });

  it('uses Russian and the chosen theme and disables reminders explicitly', async () => {
    const { notice, send } = create();
    notice.update(state(20), { ...DEFAULT_SETTINGS, language: 'ru', theme: 'dark' });
    const host = document.querySelector('[data-tad-donation]') as HTMLElement;
    expect(host.lang).toBe('ru');
    expect(host.dataset.theme).toBe('dark');
    button('Больше не показывать').click();
    await vi.waitFor(() => expect(root()).toBeUndefined());
    expect(send).toHaveBeenCalledWith({ type: 'disable_donation_reminders' });
  });

  it('keeps the reminder usable when saving a preference fails', async () => {
    const { notice } = create(vi.fn(async () => ({ ok: false })));
    notice.update(state(20), DEFAULT_SETTINGS);
    button('Not now').click();
    await vi.waitFor(() => expect(root()!.textContent).toContain('Please try again'));
    expect(button('Not now').disabled).toBe(false);
  });

  it('keeps keyboard focus on a translated action and restores a detached notice', () => {
    const { notice } = create();
    notice.update(state(20), DEFAULT_SETTINGS);
    button('Not now').focus();
    notice.update(state(20), { ...DEFAULT_SETTINGS, language: 'ru' });
    expect(root()!.activeElement).toBe(button('Не сейчас'));
    document.querySelector('[data-tad-donation]')!.remove();
    notice.update(state(21), DEFAULT_SETTINGS);
    expect(root()!.textContent).toContain('Buy the developer a coffee');
  });

  it('removes its UI permanently when the content script is invalidated', async () => {
    let resolve!: (reply: { ok: boolean }) => void;
    const { notice } = create(
      vi.fn(
        () =>
          new Promise<{ ok: boolean }>((done) => {
            resolve = done;
          }),
      ),
    );
    notice.update(state(20), DEFAULT_SETTINGS);
    button('Not now').click();
    notice.dispose();
    resolve({ ok: false });
    await Promise.resolve();
    notice.update(state(40), DEFAULT_SETTINGS);
    expect(root()).toBeUndefined();
  });
});
