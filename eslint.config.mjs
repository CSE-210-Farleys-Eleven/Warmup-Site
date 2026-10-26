import js from '@eslint/js';
import globals from 'globals';

// Rules mirror templates/code-hygiene-checklist.md. Line length is checked only on
// added lines by scripts/ci/check-hygiene.mjs, so older long lines don't fail CI.
export default [
  { ignores: ['node_modules/**', 'src/vendor/**', 'demo/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.{js,mjs}', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      semi: ['error', 'always'],
      indent: ['error', 2, { SwitchCase: 1 }],
      'eol-last': ['error', 'always'],
    },
  },
  // CLI entry points print to the terminal on purpose.
  { files: ['src/data.js', 'scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
  { files: ['server.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
];
