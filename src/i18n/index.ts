import type { ErrorCode } from '../domain/errors';
import type { JobState, Settings } from '../domain/jobs';
import type { MediaKind } from '../domain/media';

export type Language = 'ru' | 'en';

export function resolveLanguage(
  language: Settings['language'],
  browserLanguage = navigator.language,
): Language {
  return language === 'auto'
    ? browserLanguage.toLowerCase().startsWith('ru')
      ? 'ru'
      : 'en'
    : language;
}

interface Messages {
  tagline: string;
  settings: string;
  closeSettings: string;
  connected: string;
  waitingConnection: string;
  noConnection: string;
  connectionHint: string;
  downloads: string;
  history: string;
  clearHistory: string;
  emptyTitle: string;
  emptyHint: string;
  openTelegram: string;
  noHistory: string;
  cancel: string;
  retry: string;
  source: string;
  retryHint: string;
  retryNotice: string;
  sourceNotice: string;
  sourceUnavailable: string;
  interruptedHint: string;
  downloadingUnknown: string;
  keepTabOpen: string;
  language: string;
  autoLanguage: string;
  theme: string;
  systemTheme: string;
  lightTheme: string;
  darkTheme: string;
  keepHistory: string;
  historyHint: string;
  localHint: string;
  help: string;
  reportIssue: string;
  donate: string;
  donateHint: string;
  loading: string;
  unavailable: string;
  operationFailed: string;
  refresh: string;
  closeNotice: string;
  states: Record<JobState, string>;
  kinds: Record<MediaKind, string>;
}

export const messages: Record<Language, Messages> = {
  en: {
    tagline: 'Your files. On your device.',
    settings: 'Settings',
    closeSettings: 'Close settings',
    connected: 'Connected',
    waitingConnection: 'Waiting for Telegram',
    noConnection: 'Open Telegram Web to begin',
    connectionHint:
      'Sign in and open a chat with an attachment. Keep the Telegram tab open while saving.',
    downloads: 'In progress',
    history: 'Recent downloads',
    clearHistory: 'Clear history',
    emptyTitle: 'Save something worth keeping',
    emptyHint:
      'Open a chat in Telegram Web and use the Save button beside an attachment. Choose where to save the file.',
    openTelegram: 'Open Telegram Web',
    noHistory: 'Your saved files will appear here.',
    cancel: 'Cancel',
    retry: 'Retry in Telegram',
    source: 'Open source message',
    retryHint:
      'Retry opens Telegram. Click Save beside the attachment to choose a destination and start again.',
    retryNotice: 'Continue in Telegram: click Save beside the attachment to start a new download.',
    sourceNotice: 'The source was opened in Telegram.',
    sourceUnavailable: 'Open the original chat in Telegram and find this attachment.',
    interruptedHint:
      'The Telegram tab was closed or reloaded. Open the attachment and save it again.',
    downloadingUnknown: 'Total size unknown',
    keepTabOpen: 'Keep the Telegram tab open until the file is saved.',
    language: 'Language',
    autoLanguage: 'Browser language',
    theme: 'Appearance',
    systemTheme: 'System',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    keepHistory: 'Keep download history',
    historyHint:
      'Remember file names and source messages on this device. Turning this off removes finished entries.',
    localHint: 'Files go directly from Telegram to your device.',
    help: 'Help & source',
    reportIssue: 'Report an issue',
    donate: 'Buy the developer a coffee',
    donateHint: 'Free and open source. Always.',
    loading: 'Loading downloads…',
    unavailable: 'Could not connect to the extension. Try reopening this popup.',
    operationFailed: 'This action could not be completed. Please try again.',
    refresh: 'Try again',
    closeNotice: 'Dismiss message',
    states: {
      queued: 'Queued',
      downloading: 'Downloading',
      finalizing: 'Saving to disk',
      completed: 'Saved',
      failed: 'Not saved',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted',
    },
    kinds: {
      photo: 'Photo',
      video: 'Video',
      audio: 'Audio',
      voice: 'Voice message',
      'round-video': 'Video message',
      animation: 'Animation',
      document: 'Document',
      sticker: 'Sticker',
    },
  },
  ru: {
    tagline: 'Ваши файлы. На вашем устройстве.',
    settings: 'Настройки',
    closeSettings: 'Закрыть настройки',
    connected: 'Подключено',
    waitingConnection: 'Ожидание Telegram',
    noConnection: 'Для начала откройте Telegram Web',
    connectionHint:
      'Войдите в аккаунт и откройте чат с вложением. Оставьте вкладку Telegram открытой на время скачивания.',
    downloads: 'Загружается',
    history: 'Последние загрузки',
    clearHistory: 'Очистить историю',
    emptyTitle: 'Сохраните то, что важно',
    emptyHint:
      'Откройте чат в Telegram Web и нажмите «Сохранить» рядом с вложением. Выберите место для файла.',
    openTelegram: 'Открыть Telegram Web',
    noHistory: 'Здесь появятся сохранённые файлы.',
    cancel: 'Отменить',
    retry: 'Повторить в Telegram',
    source: 'Открыть исходное сообщение',
    retryHint:
      'Откроется Telegram. Нажмите «Сохранить» рядом с вложением, чтобы выбрать место и начать заново.',
    retryNotice:
      'Продолжите в Telegram: нажмите «Сохранить» рядом с вложением, чтобы начать новую загрузку.',
    sourceNotice: 'Исходное сообщение открыто в Telegram.',
    sourceUnavailable: 'Откройте исходный чат в Telegram и найдите это вложение.',
    interruptedHint:
      'Вкладка Telegram была закрыта или обновлена. Откройте вложение и сохраните его заново.',
    downloadingUnknown: 'Полный размер неизвестен',
    keepTabOpen: 'Не закрывайте вкладку Telegram до завершения сохранения.',
    language: 'Язык',
    autoLanguage: 'Язык браузера',
    theme: 'Оформление',
    systemTheme: 'Системное',
    lightTheme: 'Светлое',
    darkTheme: 'Тёмное',
    keepHistory: 'Сохранять историю загрузок',
    historyHint:
      'Имена файлов и ссылки на сообщения остаются на устройстве. Отключение удаляет завершённые записи.',
    localHint: 'Файлы идут из Telegram прямо на ваше устройство.',
    help: 'Помощь и исходный код',
    reportIssue: 'Сообщить о проблеме',
    donate: 'Купить кофе разработчику',
    donateHint: 'Бесплатно и с открытым кодом. Всегда.',
    loading: 'Загружаем список…',
    unavailable: 'Не удалось связаться с расширением. Попробуйте открыть это окно заново.',
    operationFailed: 'Не удалось выполнить действие. Попробуйте ещё раз.',
    refresh: 'Попробовать снова',
    closeNotice: 'Закрыть уведомление',
    states: {
      queued: 'В очереди',
      downloading: 'Скачивается',
      finalizing: 'Записывается на диск',
      completed: 'Сохранено',
      failed: 'Не сохранено',
      cancelled: 'Отменено',
      interrupted: 'Прервано',
    },
    kinds: {
      photo: 'Фото',
      video: 'Видео',
      audio: 'Аудио',
      voice: 'Голосовое',
      'round-video': 'Кружочек',
      animation: 'Анимация',
      document: 'Документ',
      sticker: 'Стикер',
    },
  },
};

export const errorMessages: Record<Language, Record<ErrorCode, string>> = {
  en: {
    unsupported_client:
      'This Telegram version is not supported yet. Update the extension and reload Telegram.',
    source_unavailable: 'The file is no longer available. Open the original message and try again.',
    account_changed:
      'The Telegram account changed. Switch back to the account that can access this message.',
    ambiguous_media:
      'This attachment could not be identified reliably. Open its original message and try again.',
    invalid_response:
      'Telegram returned an incomplete or unexpected file. Nothing was marked as saved. Try again.',
    network_error: 'The connection was lost. Check your network and try again.',
    timeout: 'Telegram did not respond in time. Check your connection and try again.',
    file_too_large: 'This file exceeds the supported size for this download method.',
    disk_error: 'The file could not be written. Check free space and access to the chosen folder.',
    cancelled: 'The download was cancelled. You can start it again in Telegram.',
    destination_required: 'Choose a save location from the attachment’s Save button in Telegram.',
  },
  ru: {
    unsupported_client:
      'Эта версия Telegram пока не поддерживается. Обновите расширение и перезагрузите Telegram.',
    source_unavailable: 'Файл больше недоступен. Откройте исходное сообщение и попробуйте ещё раз.',
    account_changed:
      'Аккаунт Telegram изменился. Вернитесь в аккаунт, которому доступно это сообщение.',
    ambiguous_media:
      'Не удалось точно определить вложение. Откройте исходное сообщение и попробуйте ещё раз.',
    invalid_response:
      'Telegram вернул неполный или неожиданный файл. Он не отмечен как сохранённый. Попробуйте ещё раз.',
    network_error: 'Соединение потеряно. Проверьте интернет и повторите загрузку.',
    timeout: 'Telegram не ответил вовремя. Проверьте соединение и попробуйте ещё раз.',
    file_too_large: 'Размер файла превышает предел этого способа скачивания.',
    disk_error: 'Не удалось записать файл. Проверьте свободное место и доступ к выбранной папке.',
    cancelled: 'Скачивание отменено. Его можно запустить заново в Telegram.',
    destination_required:
      'Выберите место для файла через кнопку «Сохранить» рядом с вложением в Telegram.',
  },
};
