import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const e2e = process.env.TABLAR_E2E === '1';
/** Opt-in: chrome.processes only exists on the Chromium Dev channel. */
const withProcesses = process.env.TABLAR_PROCESSES === '1';

export default defineConfig({
  srcDir: 'src',
  outDir: e2e ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // The E2E bridge content script only exists in test builds.
    'entrypoints:resolved': (_wxt, entrypoints) => {
      if (e2e) return;
      const i = entrypoints.findIndex((ep) => ep.name === 'e2e-bridge');
      if (i !== -1) entrypoints.splice(i, 1);
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: { __TABLAR_E2E__: JSON.stringify(e2e) },
  }),
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    const permissions = ['tabs', 'storage', 'alarms'];
    if (!isFirefox) permissions.push('system.memory');
    if (!isFirefox && withProcesses) permissions.push('processes');

    return {
      name: 'Tablar',
      short_name: 'Tablar',
      description:
        "Suspends inactive tabs with the browser's native discard. Local-only, no telemetry.",
      permissions,
      optional_permissions: ['notifications'],
      ...(e2e ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
      action: { default_title: 'Tablar' },
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'tablar@yodacodes12.dev',
                strict_min_version: '140.0',
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
    };
  },
});
