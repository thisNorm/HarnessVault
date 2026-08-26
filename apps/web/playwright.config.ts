import { defineConfig, devices } from '@playwright/test';

/**
 * 웹 콘솔 렌더 검증.
 *
 * API e2e가 잡을 수 없는 것만 본다 — 라우트가 실제로 그려지는가,
 * 브라우저 상태가 이동·새로고침을 견디는가. 도메인 로직은 이미 `test:e2e`가 검증한다.
 * 여기에 도메인 규칙 테스트를 옮기면 느린 곳에서 같은 것을 두 번 확인하게 된다.
 */
export default defineConfig({
  testDir: './e2e',
  // 콘솔은 서버 상태를 공유하므로 순서를 섞지 않는다.
  fullyParallel: false,
  workers: 1,
  // 재시도하지 않는다. 흔들리는 테스트를 감추면 없는 것보다 나쁘다 —
  // 실제로 한 번 감출 뻔했고, 원인은 목록이 채워지기 전에 읽는 경쟁이었다.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // 이미 떠 있으면 그대로 쓴다. API 서버는 별도로 띄워야 한다(test:e2e와 같은 전제).
  webServer: {
    command: 'npm run dev -w @harnessvault/web',
    url: process.env.WEB_URL ?? 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: '../..',
  },
});
