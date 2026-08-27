// 콘솔 화면을 실제 브라우저로 캡처한다. 시각 검증의 증거물이 된다.
//
// 사용: node apps/web/e2e/capture.mjs <출력디렉터리>
//   API·웹 서버가 떠 있어야 하고, 로그인 계정은 seed(test@test.com/1234)를 쓴다.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? '.superloopy/evidence/frontend/shots';
const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SEED_EMAIL ?? 'test@test.com';
const PASSWORD = process.env.SEED_PASSWORD ?? '1234'; // secret-scan:allow

// 라우트마다 다른 레이아웃 계열을 담아 한쪽만 좋아 보이는 것을 막는다.
const ROUTES = [
  ['login', '/login'],
  ['approvals', '/approvals'],
  ['traces', '/traces'],
  ['analytics', '/analytics'],
  ['resolve', '/resolve'],
  ['assets', '/assets'],
  ['candidates', '/candidates'],
  ['admin-organization', '/admin/organization'],
  ['admin-policies', '/admin/policies'],
  ['admin-output-contracts', '/admin/output-contracts'],
];

// 390: 모바일, 768: 태블릿, 1280: 데스크톱
const VIEWPORTS = [
  ['390', 390, 844],
  ['768', 768, 1024],
  ['1280', 1280, 900],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'ko-KR' });
const page = await context.newPage();

// 로그인은 API로 직접 한다. 화면이 깨져 있어도 나머지를 찍을 수 있어야 한다.
const login = await context.request.post(`${API}/auth/login`, {
  data: { email: EMAIL, password: PASSWORD },
});
if (!login.ok()) {
  console.error(`로그인 실패 ${login.status()} — SEED_EMAIL/SEED_PASSWORD 확인`);
  await browser.close();
  process.exit(1);
}

// 자산이 있는 조직을 고른다. 빈 조직을 찍으면 밀도를 볼 수 없다.
const me = await (await context.request.get(`${API}/auth/me`)).json();
const seeded =
  me.organizations.find((org) => org.slug.startsWith('acme-seed')) ?? me.organizations[0];
if (seeded) {
  await context.addInitScript(
    (id) => window.localStorage.setItem('harness.orgId', id),
    seeded.id,
  );
  console.log(`조직: ${seeded.name} (${seeded.slug})`);
}

const problems = [];

for (const [label, width, height] of VIEWPORTS) {
  await page.setViewportSize({ width, height });
  for (const [name, path] of ROUTES) {
    const errors = [];
    const onError = (error) => errors.push(error.message);
    page.on('pageerror', onError);

    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
    // 데이터가 들어와 레이아웃이 자리 잡을 시간을 준다.
    await page.waitForTimeout(700);

    // 가로 스크롤은 반응형 실패의 가장 흔한 형태다. 캡처하면서 함께 잰다.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) problems.push(`${path} @${width} 가로 스크롤`);
    for (const message of errors) problems.push(`${path} @${width} 오류: ${message}`);

    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true });
    page.off('pageerror', onError);
  }
}

await browser.close();

console.log(`캡처 완료 → ${OUT} (${ROUTES.length * VIEWPORTS.length}장)`);
if (problems.length > 0) {
  console.log('\n발견된 문제');
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('가로 스크롤·렌더 오류 없음');
