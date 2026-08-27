import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

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
    //
    // 전역 목록을 손으로 관리하지 않는다. 빠뜨린 하나 때문에 lint가 실패하는데
    // 그건 코드 문제가 아니라 목록 문제다 — 실제로 `AbortSignal`·`setTimeout`에서 그랬다.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Playwright 스크립트는 page.evaluate 안에서 브라우저 전역을 쓴다.
    // Node 전역만 주면 그 블록이 전부 no-undef로 잡힌다.
    files: ['apps/web/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
