import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __TAD_BUILD__: JSON.stringify({
      version: '0.0.0-test',
      id: 'abc1234',
      commit: 'abc1234def5678abc1234def5678abc1234def56',
      modified: false,
    }),
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'happy-dom',
    restoreMocks: true,
  },
});
