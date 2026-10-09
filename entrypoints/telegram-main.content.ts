import { createWebAAdapter } from '../src/adapters/telegram-a';
import { createWebKAdapter } from '../src/adapters/telegram-k';
import { startPageController } from '../src/page/controller';

export default defineContentScript({
  matches: ['https://web.telegram.org/a/*', 'https://web.telegram.org/k/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const adapter = location.pathname.startsWith('/a/') ? createWebAAdapter() : createWebKAdapter();
    startPageController(adapter);
  },
});
