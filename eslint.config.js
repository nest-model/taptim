import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'supabase/functions/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Security: never render raw HTML from users.
      'react/no-danger': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML запрещён: пользовательский контент рендерится только как текст.',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'eval', message: 'eval запрещён' },
      ],
    },
  },
  {
    // context providers, router and i18n intentionally export hooks/config next to components
    files: ['src/router.tsx', 'src/providers/**', 'src/i18n/**', 'src/components/listing/parts.tsx', 'src/components/guards.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
