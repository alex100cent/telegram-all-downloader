import type { Settings } from '../domain/jobs';
import type { MediaInfo, MediaKind } from '../domain/media';
import { directoryFilename, type DirectoryOptions } from '../downloads/destination';
import { messages, resolveLanguage } from '../i18n';
import { formatBytes } from '../ui/format';

export interface BatchEntry {
  key: string;
  info: MediaInfo;
  album?: string;
  disabled?: boolean;
}
export interface BatchPanel {
  open(entries?: BatchEntry[], selected?: string[]): void;
  updateSettings(settings: Settings): void;
  setBusy(busy: boolean): void;
  showResult(text: string): void;
  dispose(): void;
}

const copy = {
  en: {
    title: 'Download several',
    hint: 'Only attachments discovered on this page are listed (up to 200). Scroll the chat, then refresh. This is not the entire channel.',
    refresh: 'Refresh list',
    all: 'Select all shown',
    none: 'Clear selection',
    close: 'Close',
    type: 'Attachment type',
    any: 'All types',
    names: 'File names',
    original: 'Original names',
    message: 'Message ID + name',
    numbered: 'Number + name',
    collision: 'Existing files',
    keep: 'Keep both',
    skip: 'Skip existing',
    overwrite: 'Overwrite',
    overwriteHint:
      'Existing files with matching names will be replaced only after a successful save.',
    start: 'Choose folder and download',
    unknown: 'size unknown',
    selected: 'Selected',
    known: 'Known size',
    unavailable: 'Already downloading',
    empty: 'No ready attachments. Wait a moment or scroll the chat, then refresh.',
    album: 'Select album items',
    busy: 'Adding files to the queue…',
    limit:
      'Keep Telegram open. Files are saved one at a time. Closing this panel does not stop the queue.',
  },
  ru: {
    title: 'Скачать несколько',
    hint: 'Здесь только обнаруженные на странице вложения (до 200). Прокрутите чат и обновите список. Это не весь канал.',
    refresh: 'Обновить список',
    all: 'Выбрать показанные',
    none: 'Снять выбор',
    close: 'Закрыть',
    type: 'Тип вложения',
    any: 'Все типы',
    names: 'Имена файлов',
    original: 'Исходные имена',
    message: 'ID сообщения + имя',
    numbered: 'Номер + имя',
    collision: 'Если файл существует',
    keep: 'Сохранить оба',
    skip: 'Пропустить',
    overwrite: 'Перезаписать',
    overwriteHint: 'Файлы с совпадающими именами будут заменены только после успешного сохранения.',
    start: 'Выбрать папку и скачать',
    unknown: 'размер неизвестен',
    selected: 'Выбрано',
    known: 'Известный размер',
    unavailable: 'Уже скачивается',
    empty: 'Нет готовых вложений. Подождите или прокрутите чат и обновите список.',
    album: 'Выбрать элементы альбома',
    busy: 'Добавляем файлы в очередь…',
    limit:
      'Оставьте Telegram открытым. Файлы сохраняются по очереди. Закрытие этой панели не останавливает очередь.',
  },
};

export function createBatchPanel(options: {
  settings: Settings;
  entries(): BatchEntry[];
  download(
    entries: BatchEntry[],
    options: Omit<DirectoryOptions, 'index'>,
    event: MouseEvent,
  ): void;
}): BatchPanel {
  let settings = options.settings;
  let host: HTMLElement | undefined;
  let body: HTMLElement | undefined;
  let previousFocus: Element | null;
  let entries: BatchEntry[] = [];
  const selected = new Set<string>();
  let filter: MediaKind | '' = '';
  let naming: DirectoryOptions['naming'] = 'original';
  let collision: DirectoryOptions['collision'] = 'keep-both';
  let busy = false;
  let result = '';
  const language = () => resolveLanguage(settings.language);
  const words = () => copy[language()];
  const button = (label: string, action: (event: MouseEvent) => void) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.focusKey = `button:${label}`;
    node.onclick = action;
    return node;
  };
  function close() {
    host?.remove();
    host = undefined;
    body = undefined;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
  function dropdown(
    label: string,
    values: Array<[string, string]>,
    current: string,
    change: (value: string) => void,
  ) {
    const node = document.createElement('label');
    node.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    select.dataset.focusKey = `select:${label}`;
    for (const [value, text] of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = current;
    select.disabled = busy;
    select.onchange = () => {
      change(select.value);
      render();
    };
    node.append(select);
    return node;
  }
  function render() {
    if (!body || !host) return;
    const focused = host.shadowRoot?.activeElement?.getAttribute('data-focus-key');
    const scroll = body.querySelector('.files')?.scrollTop ?? 0;
    body.replaceChildren();
    host.dataset.theme = settings.theme;
    const t = words();
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = t.title;
    const dismiss = button(t.close, close);
    header.append(title, dismiss);
    const hint = document.createElement('p');
    hint.textContent = t.hint;
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.append(
      dropdown(
        t.type,
        [['', t.any], ...Object.entries(messages[language()].kinds)],
        filter,
        (value) => {
          filter = value as MediaKind | '';
        },
      ),
    );
    const refresh = button(t.refresh, () => {
      entries = options.entries().slice(0, 200);
      for (const key of selected)
        if (!entries.some((entry) => entry.key === key && !entry.disabled)) selected.delete(key);
      result = '';
      render();
    });
    refresh.disabled = busy;
    toolbar.append(refresh);
    const shown = entries.filter((entry) => !filter || entry.info.kind === filter);
    const all = button(t.all, () => {
      for (const entry of shown) if (!entry.disabled) selected.add(entry.key);
      render();
    });
    const none = button(t.none, () => {
      selected.clear();
      render();
    });
    all.disabled = none.disabled = busy;
    toolbar.append(all, none);
    const files = document.createElement('div');
    files.className = 'files';
    const chosen = entries.filter((entry) => selected.has(entry.key) && !entry.disabled);
    if (!shown.length) files.textContent = t.empty;
    const albums = new Set<string>();
    for (const entry of shown) {
      if (entry.album && !albums.has(entry.album)) {
        albums.add(entry.album);
        const members = shown.filter((item) => item.album === entry.album && !item.disabled);
        if (members.length > 1) {
          const album = button(`${t.album} (${members.length})`, () => {
            for (const item of members) selected.add(item.key);
            render();
          });
          album.disabled = busy;
          album.dataset.focusKey = `album:${entry.album}`;
          files.append(album);
        }
      }
      const label = document.createElement('label');
      label.className = 'file';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selected.has(entry.key);
      input.disabled = busy || !!entry.disabled;
      input.setAttribute('aria-label', entry.info.filename);
      input.dataset.focusKey = `file:${entry.key}`;
      input.onchange = () => {
        if (input.checked) selected.add(entry.key);
        else selected.delete(entry.key);
        render();
      };
      const details = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = entry.info.filename;
      const meta = document.createElement('small');
      meta.textContent = `${messages[language()].kinds[entry.info.kind]} · ${entry.info.byteSize === undefined ? t.unknown : formatBytes(entry.info.byteSize, language())}${entry.disabled ? ` · ${t.unavailable}` : ''}`;
      details.append(name, meta);
      if (input.checked && naming !== 'original') {
        const preview = document.createElement('small');
        preview.textContent = `→ ${directoryFilename(entry.info, { naming, index: chosen.indexOf(entry) + 1 })}`;
        details.append(preview);
      }
      label.append(input, details);
      files.append(label);
    }
    const destination = document.createElement('div');
    destination.className = 'toolbar';
    destination.append(
      dropdown(
        t.names,
        [
          ['original', t.original],
          ['message', t.message],
          ['numbered', t.numbered],
        ],
        naming,
        (value) => {
          naming = value as typeof naming;
        },
      ),
      dropdown(
        t.collision,
        [
          ['keep-both', t.keep],
          ['skip', t.skip],
          ['overwrite', t.overwrite],
        ],
        collision,
        (value) => {
          collision = value as typeof collision;
        },
      ),
    );
    const summary = document.createElement('p');
    summary.className = 'summary';
    summary.setAttribute('role', 'status');
    const known = chosen.reduce((total, entry) => total + (entry.info.byteSize ?? 0), 0);
    const unknown = chosen.filter((entry) => entry.info.byteSize === undefined).length;
    summary.textContent = `${t.selected}: ${chosen.length} · ${t.known}: ${formatBytes(known, language())}${unknown ? ` · ${unknown}: ${t.unknown}` : ''}`;
    const start = button(t.start, (event) =>
      options.download(chosen, { naming, collision }, event),
    );
    start.disabled = busy || !chosen.length;
    start.className = 'primary';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = busy ? t.busy : result;
    const limit = document.createElement('p');
    limit.textContent = t.limit;
    body.append(header, hint, toolbar, files, destination);
    if (collision === 'overwrite') {
      const warning = document.createElement('p');
      warning.textContent = t.overwriteHint;
      body.append(warning);
    }
    body.append(summary, start, status, limit);
    files.scrollTop = scroll;
    if (focused)
      [...body.querySelectorAll<HTMLElement>('[data-focus-key]')]
        .find((element) => element.dataset.focusKey === focused)
        ?.focus();
  }
  return {
    open(initial, keys) {
      if (busy) return;
      entries = (initial ?? options.entries()).slice(0, 200);
      selected.clear();
      for (const key of keys ?? [])
        if (entries.some((entry) => entry.key === key && !entry.disabled)) selected.add(key);
      result = '';
      filter = '';
      if (!host) {
        previousFocus = document.activeElement;
        host = document.createElement('div');
        host.dataset.tadBatch = 'true';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `:host{--bg:#fff;--fg:#14323c;--line:#b9ced6;--muted:#45616b;position:fixed;inset:0;z-index:2147483645;background:#0006;display:grid;place-items:center;font:14px/1.45 system-ui;color:var(--fg);color-scheme:light}*{box-sizing:border-box}section{width:min(780px,94vw);max-height:92vh;overflow:auto;background:var(--bg);border-radius:16px;padding:22px;box-shadow:0 12px 64px #0005}header,.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header{justify-content:space-between}h2{margin:0;font-size:22px}p{color:var(--muted);margin:12px 0}.toolbar{margin:14px 0}.toolbar label{display:grid;gap:4px;flex:1;min-width:145px}select,button{font:inherit;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);padding:8px 12px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #008da4;outline-offset:2px}.files{max-height:32vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px}.file{display:flex;gap:12px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}.file:last-child{border-bottom:0}.file span{min-width:0}.file strong,.file small{display:block;overflow-wrap:anywhere}.file small{color:var(--muted);margin-top:3px}.file input{width:18px;height:18px;flex-shrink:0;accent-color:#007b91}.summary{font-weight:600;color:var(--fg)}.primary{background:#006f83;color:#fff;font-weight:600}:host([data-theme=dark]){--bg:#13262e;--fg:#edfaff;--line:#45616b;--muted:#b8cdd5;color-scheme:dark}@media(prefers-color-scheme:dark){:host([data-theme=system]){--bg:#13262e;--fg:#edfaff;--line:#45616b;--muted:#b8cdd5;color-scheme:dark}}`;
        body = document.createElement('section');
        body.setAttribute('role', 'dialog');
        body.setAttribute('aria-modal', 'true');
        body.setAttribute('aria-label', words().title);
        body.tabIndex = -1;
        shadow.append(style, body);
        host.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
          if (event.key === 'Tab' && body) {
            const focusable = [
              ...body.querySelectorAll<HTMLElement>(
                'button:not(:disabled),select:not(:disabled),input:not(:disabled)',
              ),
            ];
            const current = shadow.activeElement;
            if (event.shiftKey && (current === focusable[0] || current === body)) {
              event.preventDefault();
              focusable.at(-1)?.focus();
            } else if (!event.shiftKey && current === focusable.at(-1)) {
              event.preventDefault();
              focusable[0]?.focus();
            }
          }
        });
        document.documentElement.append(host);
      }
      render();
      body?.focus();
    },
    updateSettings(value) {
      settings = value;
      render();
    },
    setBusy(value) {
      busy = value;
      render();
    },
    showResult(value) {
      result = value;
      render();
    },
    dispose: close,
  };
}
