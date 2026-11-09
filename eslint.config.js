import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.output', '.output-e2e', '.wxt', 'node_modules', 'test-results', 'playwright-report', 'web-ext-artifacts', '.venv-e2e'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { defineBackground: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  { files: ['scripts/**', 'tests/e2e/server.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } } },
);
