import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Telegram All Downloader',
    description: 'Save Telegram Web message attachments with a local download queue.',
    permissions: ['storage'],
    host_permissions: ['https://web.telegram.org/*'],
    minimum_chrome_version: '120',
    homepage_url: 'https://github.com/alex100cent/telegram-all-downloader',
    action: { default_title: 'Telegram All Downloader' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
});
