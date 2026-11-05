import js from '@eslint/js';
import globals from 'globals';
import boundaries from './eslint-rules/workspace-imports.js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', 'spikes/**', '**/db/types.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}'],
    plugins: { boundaries },
    rules: { 'boundaries/workspace-imports': 'error' },
  },
);
