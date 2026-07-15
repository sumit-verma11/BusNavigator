import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'error', // use the pino logger, not console
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-process-env': 'off',
    },
  },
  {
    // config module is the ONLY place allowed to read process.env directly
    files: ['**/src/config/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // Web workspace: JSX, browser globals, React rules.
    files: ['apps/web/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules, // React 19: no `import React` needed
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Accessibility is a build failure here, not a warning nobody reads.
      'jsx-a11y/no-autofocus': 'error',
      'react/prop-types': 'off', // no TS, and prop-types is not worth the ceremony
    },
  },
  prettier,
];
