import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import { readBuildInfo, versionName } from './scripts/build-info';

const build = readBuildInfo(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ define: { __TAD_BUILD__: JSON.stringify(build) } }),
  manifest: {
    name: 'Telegram All Downloader',
    description: 'Save Telegram Web message attachments with a local download queue.',
    version_name: versionName(build),
    permissions: ['storage'],
    host_permissions: ['https://web.telegram.org/*'],
    minimum_chrome_version: '120',
    homepage_url: 'https://github.com/alex100cent/telegram-all-downloader',
    action: { default_title: 'Telegram All Downloader' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
});
