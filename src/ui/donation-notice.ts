import { DONATION_URL } from '../config';
import {
  DEFAULT_DONATION_STATE,
  pendingDonationMilestone,
  type DonationState,
} from '../domain/donations';
import type { Settings } from '../domain/jobs';
import { messages, resolveLanguage } from '../i18n';

type DonationAction =
  { type: 'dismiss_donation'; milestone: number } | { type: 'disable_donation_reminders' };

export function createDonationNotice(send: (action: DonationAction) => Promise<{ ok: boolean }>) {
  let host: HTMLElement | undefined;
  let donation: DonationState = { ...DEFAULT_DONATION_STATE };
  let settings: Settings;
  let signature = '';
  let pending = false;
  let failed = false;
  let disposed = false;

  function remove() {
    host?.remove();
    host = undefined;
    signature = '';
  }

  async function act(action: DonationAction) {
    if (pending) return;
    pending = true;
    failed = false;
    host?.shadowRoot?.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    try {
      if (!(await send(action)).ok) throw new Error('Donation preference was not saved');
      if (action.type === 'disable_donation_reminders')
        settings = { ...settings, donationReminders: false };
      else
        donation = {
          ...donation,
          dismissedMilestone: Math.max(donation.dismissedMilestone, action.milestone),
        };
    } catch {
      failed = true;
    } finally {
      pending = false;
      render();
    }
  }

  function render() {
    if (disposed) return;
    const milestone = pendingDonationMilestone(donation);
    if (!settings.donationReminders || milestone === undefined) {
      remove();
      return;
    }
    const language = resolveLanguage(settings.language);
    const nextSignature = `${milestone}:${language}:${settings.theme}:${pending}:${failed}`;
    if (host?.isConnected && signature === nextSignature) return;
    const focusedAction = host?.isConnected
      ? (host.shadowRoot?.activeElement as HTMLElement | null)?.dataset.action
      : undefined;
    signature = nextSignature;
    if (!host) {
      host = document.createElement('div');
      host.dataset.tadDonation = '';
      host.attachShadow({ mode: 'open' });
    }
    if (!host.isConnected) document.documentElement.append(host);
    host.dataset.theme = settings.theme;
    host.lang = language;
    const t = messages[language];
    const root = host.shadowRoot!;
    const style = document.createElement('style');
    style.textContent = `
      :host { all:initial; --bg:#fff; --fg:#19313b; --muted:#526771; --line:#ccdbe1;
        position:fixed; right:16px; bottom:88px; z-index:2147483641;
        display:block; width:min(320px,calc(100vw - 32px)); color:var(--fg);
        font:13px/1.45 system-ui,sans-serif; color-scheme:light; }
      * { box-sizing:border-box; }
      section { padding:16px; background:var(--bg); border:1px solid var(--line);
        border-radius:14px; box-shadow:0 6px 24px #0002; max-height:calc(100vh - 120px); overflow:auto; }
      h2 { font-size:15px; margin:0 0 6px; }
      p { color:var(--muted); margin:0 0 12px; }
      .actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
      a,button { font:inherit; cursor:pointer; border-radius:6px; }
      a { background:#08758a; color:white; padding:7px 11px; text-decoration:none; font-weight:600; }
      button { border:0; padding:5px 0; color:var(--muted); background:transparent; text-decoration:underline; }
      button:disabled { opacity:.6; cursor:default; }
      a:focus-visible,button:focus-visible { outline:3px solid #32a9e1; outline-offset:3px; }
      .never { display:block; margin-top:8px; font-size:12px; }
      .error { margin:10px 0 0; }
      :host([data-theme=dark]) { --bg:#18232e; --fg:#f0f4fa; --muted:#b0bfd0; --line:#394958; color-scheme:dark; }
      @media(prefers-color-scheme:dark) {
        :host([data-theme=system]) { --bg:#18232e; --fg:#f0f4fa; --muted:#b0bfd0; --line:#394958; color-scheme:dark; }
      }
    `;
    const section = document.createElement('section');
    section.setAttribute('aria-label', t.donate);
    const title = document.createElement('h2');
    title.textContent = `☕ ${t.donate}`;
    const description = document.createElement('p');
    description.textContent = t.donationMessage;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const link = document.createElement('a');
    link.href = DONATION_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.action = 'donate';
    link.textContent = t.donationAction;
    link.onclick = () => {
      void act({ type: 'dismiss_donation', milestone });
    };
    const later = document.createElement('button');
    later.type = 'button';
    later.dataset.action = 'later';
    later.textContent = t.donationNotNow;
    later.disabled = pending;
    later.onclick = () => {
      void act({ type: 'dismiss_donation', milestone });
    };
    actions.append(link, later);
    const never = document.createElement('button');
    never.className = 'never';
    never.type = 'button';
    never.dataset.action = 'never';
    never.textContent = t.donationNever;
    never.disabled = pending;
    never.onclick = () => {
      void act({ type: 'disable_donation_reminders' });
    };
    section.append(title, description, actions, never);
    if (failed) {
      const error = document.createElement('p');
      error.className = 'error';
      error.setAttribute('role', 'status');
      error.textContent = t.operationFailed;
      section.append(error);
    }
    root.replaceChildren(style, section);
    if (focusedAction)
      root
        .querySelector<HTMLElement>(`[data-action="${focusedAction}"]`)
        ?.focus({ preventScroll: true });
  }

  return {
    update(state: DonationState, preferences: Settings) {
      donation = {
        completedDownloads: Math.max(donation.completedDownloads, state.completedDownloads),
        dismissedMilestone: Math.max(donation.dismissedMilestone, state.dismissedMilestone),
      };
      settings = preferences;
      render();
    },
    dispose() {
      disposed = true;
      remove();
    },
  };
}
