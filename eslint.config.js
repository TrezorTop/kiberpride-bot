// Lint, plus the dependency direction of decision 002 §2 enforced per folder:
//   discord → modules → core, db      (modules never import discord.js)
//   matches → rewards → economy, shop → economy, * → permissions, settings, logging; no cycles.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DISCORD_LIB = {
  group: ['discord.js', '@discordjs/*', 'discord-api-types', 'discord-api-types/*'],
  message: 'Only src/discord talks to Discord; use the ports in src/core/ports.ts (decision 002 §2).',
};
const DISCORD_LAYER = {
  group: ['**/discord/*', '**/discord'],
  message: 'The Discord adapter depends on modules, never the other way (decision 002 §2).',
};

// Module → the sibling modules it may import. Everything else is refused.
const MODULE_EDGES = {
  settings: [],
  permissions: [],
  logging: ['settings'],
  economy: ['permissions', 'settings', 'logging'],
  games: ['permissions', 'settings', 'logging'],
  rewards: ['economy', 'games', 'permissions', 'settings', 'logging'],
  shop: ['economy', 'permissions', 'settings', 'logging'],
  matches: ['rewards', 'economy', 'games', 'permissions', 'settings', 'logging'],
};
const MODULES = Object.keys(MODULE_EDGES);

const moduleBoundaries = Object.entries(MODULE_EDGES).map(([mod, allowed]) => {
  const forbidden = MODULES.filter((m) => m !== mod && !allowed.includes(m));
  return {
    files: [`src/modules/${mod}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            DISCORD_LIB,
            DISCORD_LAYER,
            ...(forbidden.length
              ? [
                  {
                    group: forbidden.flatMap((m) => [`../${m}`, `../${m}/*`, `../../${m}/*`, `**/modules/${m}/*`]),
                    message: `modules/${mod} may import only: ${allowed.join(', ') || 'no other module'} (decision 002 §2).`,
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  // tools/ is the harness (preflight, gate): plain Node scripts with their own self-test.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**', 'tools/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/db/**/*.ts', 'src/config/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            DISCORD_LIB,
            DISCORD_LAYER,
            { group: ['**/modules/*', '**/modules'], message: 'core, db and config sit below the modules (decision 002 §2).' },
          ],
        },
      ],
    },
  },
  ...moduleBoundaries,
  {
    files: ['src/discord/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/*', '**/generated/*', '**/generated/**'],
              message: 'Handlers call module services, not the database (decision 002 §3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/jobs/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [DISCORD_LIB, DISCORD_LAYER] }] },
  },
  {
    files: ['scripts/**/*.ts', 'prisma/**/*.ts', 'tests/**/*.ts', '**/*.test.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
