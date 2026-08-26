import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'],
    // Playwright 스펙은 브라우저가 필요하다. `npm run test:web`이 따로 돌린다 —
    // 여기서 같이 집어 가면 `npm run ci`가 서버 기동을 전제하게 된다.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'apps/web/e2e/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
