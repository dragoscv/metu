import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared flat ESLint config for the metu monorepo. */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // Drizzle 0.36 has a typing bug where `.returning({ ... })` with a
      // projection produces unsound types (silently widens to `unknown`).
      // Repo convention: always call `.returning()` no-arg and read the
      // full row. See packages/db/src/queries/oauth.ts for the pattern.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='returning'][arguments.length>0]",
          message:
            'Drizzle 0.36: use `.returning()` no-arg and read full row. Projection form silently widens types.',
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/.next/**', '**/build/**', '**/node_modules/**'],
  },
);
