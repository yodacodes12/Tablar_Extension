import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  define: { __TABLAR_E2E__: 'false' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    mockReset: true,
    restoreMocks: true,
  },
});
