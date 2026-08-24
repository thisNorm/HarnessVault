import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/drizzle/**',
    ],
  },
  {
    // Node로 직접 실행하는 스크립트. TS 파일은 컴파일러가 확인하므로 no-undef가 꺼져 있다.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
