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
  donationMessage: string;
  donationAction: string;
  donationNotNow: string;
  donationNever: string;
  donationReminders: string;
  donationRemindersHint: string;
  loading: string;
  unavailable: string;
  operationFailed: string;
  refresh: string;
  closeNotice: string;
  aboutBuild: string;
  version: string;
  build: string;
  buildClean: string;
  buildModified: string;
  buildUnversioned: string;
  ciBuild: string;
  localBuild: string;
  errorCode: string;
  diagnostics: string;
  hideDiagnostics: string;
  copyDiagnostics: string;
  copied: string;
  copyManually: string;
  diagnosticsPrivacy: string;
  manager: string;
  managerHint: string;
  chooseFiles: string;
  batchHint: string;
  batchNotice: string;
  batchRetryNotice: string;
  batchActionAccepted: string;
  batchActionRejected: string;
  batchActionRejectedHint: string;
  chooseTab: string;
  browserTab: string;
  searchFiles: string;
  mediaType: string;
  allKinds: string;
  jobState: string;
  allStates: string;
  batch: string;
  allBatches: string;
  noBatch: string;
  batchSummary: string;
  batchSummaryHint: string;
  selectFile: string;
  selectPage: string;
  deselectPage: string;
  clearSelection: string;
  selected: string;
  selectionHint: string;
  cancelSelected: string;
  retrySelected: string;
  bulkHint: string;
  matchingFiles: string;
  noMatches: string;
  resetFilters: string;
  perPage: string;
  previousPage: string;
  nextPage: string;
  page: string;
  popupMore: string;
  states: Record<JobState, string>;
  kinds: Record<MediaKind, string>;
}

export const messages: Record<Language, Messages> = {
  en: {
    manager: 'Download manager',
    managerHint: 'Find downloads, review batches and manage several files at once.',
    chooseFiles: 'Choose files in Telegram',
    batchHint: 'Open a chat, select its available attachments, then choose a folder in Telegram.',
    batchNotice: 'Continue in Telegram: select attachments and choose a folder to start saving.',
    batchRetryNotice:
      'Continue in the opened Telegram tabs: review the selected files and choose a folder to retry.',
    batchActionAccepted: 'Requests accepted',
    batchActionRejected: 'Requests not accepted',
    batchActionRejectedHint:
      'Some files may have finished or their Telegram tabs may no longer be available. Check their status. To retry from a missing tab, use Open source message on the file and select it again in Telegram.',
    chooseTab: 'Telegram tab',
    browserTab: 'Tab',
    searchFiles: 'Search file names',
    mediaType: 'Media type',
    allKinds: 'All types',
    jobState: 'Status',
    allStates: 'All statuses',
    batch: 'Batch',
    allBatches: 'All downloads',
    noBatch: 'Individual downloads',
    batchSummary: 'Results',
    batchSummaryHint:
      'Counts from retained history for the chosen batch, including files hidden by filters. Clearing or disabling history changes these totals.',
    selectFile: 'Select',
    selectPage: 'Select page',
    deselectPage: 'Deselect page',
    clearSelection: 'Clear selection',
    selected: 'Selected',
    selectionHint: 'Select up to 200 files across pages. Changing a filter clears the selection.',
    cancelSelected: 'Cancel selected',
    retrySelected: 'Retry selected in Telegram',
    bulkHint:
      'Cancel applies to queued or downloading files. Retry applies to failed, cancelled or interrupted files and requires choosing a folder in Telegram.',
    matchingFiles: 'Matching files',
    noMatches: 'No downloads match these filters.',
    resetFilters: 'Reset filters',
    perPage: 'Per page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    page: 'Page',
    popupMore: 'Show all downloads',
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
      'Retry opens Telegram. Click Save beside the attachment, or choose a folder in the file selector, to start again.',
    retryNotice:
      'Continue in Telegram: choose a save location using Save beside the attachment, or choose a folder in the file selector.',
    sourceNotice: 'The source was opened in Telegram.',
    sourceUnavailable: 'Open the original chat in Telegram and find this attachment.',
    interruptedHint:
      'The Telegram tab that was saving this file was closed, reloaded or left Telegram. Open the attachment and save it again.',
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
    donationMessage:
      'Enjoying the downloads? A coffee is a welcome, optional way to support this free project.',
    donationAction: 'Buy a coffee',
    donationNotNow: 'Not now',
    donationNever: 'Don’t show again',
    donationReminders: 'Coffee reminders',
    donationRemindersHint:
      'Show a small reminder after every 20 successfully saved files. Downloads are never interrupted.',
    loading: 'Loading downloads…',
    unavailable: 'Could not connect to the extension. Try reopening this popup.',
    operationFailed: 'This action could not be completed. Please try again.',
    refresh: 'Try again',
    closeNotice: 'Dismiss message',
    aboutBuild: 'About this build',
    version: 'Version',
    build: 'Build',
    buildClean: 'Built from a commit without local changes.',
    buildModified: 'Includes local changes that are not part of the commit.',
    buildUnversioned: 'Built without Git information.',
    ciBuild: 'CI run',
    localBuild: 'Local build',
    errorCode: 'Code',
    diagnostics: 'Diagnostics',
    hideDiagnostics: 'Hide diagnostics',
    copyDiagnostics: 'Copy diagnostics',
    copied: 'Copied',
    copyManually: 'Select the text above and copy it manually.',
    diagnosticsPrivacy:
      'Only the text above is copied. It contains no file names, links, message text or account and chat IDs.',
    states: {
      queued: 'Queued',
      downloading: 'Downloading',
      finalizing: 'Saving to disk',
      completed: 'Saved',
      failed: 'Not saved',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted',
      skipped: 'Skipped',
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
    manager: 'Менеджер загрузок',
    managerHint: 'Находите загрузки, проверяйте результаты и управляйте несколькими файлами сразу.',
    chooseFiles: 'Выбрать файлы в Telegram',
    batchHint: 'Откройте чат, выберите доступные вложения, затем выберите папку в Telegram.',
    batchNotice: 'Продолжите в Telegram: выберите вложения и папку для сохранения.',
    batchRetryNotice:
      'Продолжите в открытых вкладках Telegram: проверьте выбранные файлы и выберите папку для повтора.',
    batchActionAccepted: 'Запросов принято',
    batchActionRejected: 'Запросов отклонено',
    batchActionRejectedHint:
      'Часть файлов могла завершиться или их вкладки Telegram уже недоступны. Проверьте статусы. Для повтора из закрытой вкладки нажмите «Открыть исходное сообщение» у файла и выберите его заново в Telegram.',
    chooseTab: 'Вкладка Telegram',
    browserTab: 'Вкладка',
    searchFiles: 'Поиск по имени файла',
    mediaType: 'Тип медиа',
    allKinds: 'Все типы',
    jobState: 'Статус',
    allStates: 'Все статусы',
    batch: 'Группа',
    allBatches: 'Все загрузки',
    noBatch: 'Одиночные загрузки',
    batchSummary: 'Результаты',
    batchSummaryHint:
      'Итоги выбранной группы по сохранённым записям, включая файлы, скрытые фильтрами. Очистка или отключение истории меняет эти итоги.',
    selectFile: 'Выбрать',
    selectPage: 'Выбрать страницу',
    deselectPage: 'Снять выбор страницы',
    clearSelection: 'Снять выбор',
    selected: 'Выбрано',
    selectionHint:
      'Можно выбрать до 200 файлов на разных страницах. Изменение фильтра снимает выбор.',
    cancelSelected: 'Отменить выбранные',
    retrySelected: 'Повторить выбранные в Telegram',
    bulkHint:
      'Отмена доступна для ожидающих и скачиваемых файлов. Повтор — для неудавшихся, отменённых и прерванных; папку нужно выбрать в Telegram.',
    matchingFiles: 'Найдено файлов',
    noMatches: 'Нет загрузок с такими фильтрами.',
    resetFilters: 'Сбросить фильтры',
    perPage: 'На странице',
    previousPage: 'Предыдущая страница',
    nextPage: 'Следующая страница',
    page: 'Страница',
    popupMore: 'Показать все загрузки',
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
      'Откроется Telegram. Нажмите «Сохранить» рядом с вложением или выберите папку в панели выбора файлов, чтобы начать заново.',
    retryNotice:
      'Продолжите в Telegram: выберите место через кнопку «Сохранить» рядом с вложением или папку в панели выбора файлов.',
    sourceNotice: 'Исходное сообщение открыто в Telegram.',
    sourceUnavailable: 'Откройте исходный чат в Telegram и найдите это вложение.',
    interruptedHint:
      'Вкладку Telegram, которая сохраняла файл, закрыли, перезагрузили или увели с Telegram. Откройте вложение и сохраните его заново.',
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
    donationMessage:
      'Нравится скачивать с нами? Можно угостить автора кофе и поддержать этот бесплатный проект.',
    donationAction: 'Угостить кофе',
    donationNotNow: 'Не сейчас',
    donationNever: 'Больше не показывать',
    donationReminders: 'Напоминать о поддержке',
    donationRemindersHint:
      'Небольшое напоминание после каждых 20 успешно сохранённых файлов. Загрузки не прерываются.',
    loading: 'Загружаем список…',
    unavailable: 'Не удалось связаться с расширением. Попробуйте открыть это окно заново.',
    operationFailed: 'Не удалось выполнить действие. Попробуйте ещё раз.',
    refresh: 'Попробовать снова',
    closeNotice: 'Закрыть уведомление',
    aboutBuild: 'О сборке',
    version: 'Версия',
    build: 'Сборка',
    buildClean: 'Собрано из коммита без локальных изменений.',
    buildModified: 'Содержит локальные изменения, которых нет в коммите.',
    buildUnversioned: 'Собрано без данных Git.',
    ciBuild: 'Сборка CI',
    localBuild: 'Локальная сборка',
    errorCode: 'Код',
    diagnostics: 'Диагностика',
    hideDiagnostics: 'Скрыть диагностику',
    copyDiagnostics: 'Копировать диагностику',
    copied: 'Скопировано',
    copyManually: 'Выделите текст выше и скопируйте его вручную.',
    diagnosticsPrivacy:
      'Копируется только текст выше. В нём нет имён файлов, ссылок, текста сообщений и ID аккаунтов и чатов.',
    states: {
      queued: 'В очереди',
      downloading: 'Скачивается',
      finalizing: 'Записывается на диск',
      completed: 'Сохранено',
      failed: 'Не сохранено',
      cancelled: 'Отменено',
      interrupted: 'Прервано',
      skipped: 'Пропущено',
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
