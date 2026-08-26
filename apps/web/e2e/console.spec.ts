import { createOrg, expect, signIn, test } from './fixtures';

/**
 * 콘솔 라우트가 실제로 그려지는지 본다.
 *
 * 이 파일이 존재하는 이유는 실증적이다 — 13개 Phase 동안 브라우저를 한 번도
 * 열지 않았고, 처음 열었을 때 API e2e가 못 잡은 결함 셋이 나왔다.
 */

const ROUTES = [
  { path: '/approvals', heading: '승인함' },
  { path: '/traces', heading: 'Traces' },
  { path: '/analytics', heading: 'Analytics' },
  { path: '/resolve', heading: 'Resolve Explainer' },
  { path: '/assets', heading: '자산' },
  { path: '/candidates', heading: 'Candidates' },
  { path: '/admin/organization', heading: '조직' },
  { path: '/admin/teams', heading: '팀' },
  { path: '/admin/projects', heading: '프로젝트' },
  { path: '/admin/groups', heading: '그룹' },
  { path: '/admin/resources', heading: 'Resources' },
  { path: '/admin/policies', heading: 'Policies' },
  { path: '/admin/output-contracts', heading: '산출물 계약' },
];

test.describe('콘솔 라우트', () => {
  test.beforeEach(async ({ page, request, account }) => {
    await createOrg(request, '렌더 검증', `render-${Date.now()}`);
    await signIn(page, account);
  });

  for (const route of ROUTES) {
    test(`${route.path} 가 그려진다`, async ({ page }) => {
      const errors: string[] = [];
      // 화면이 비어 있지 않다고 통과시키면 안 된다. 콘솔 오류도 함께 본다.
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
      // 사이드바가 있어야 로그인 상태로 셸 안에 들어온 것이다.
      await expect(page.getByRole('link', { name: '승인함' })).toBeVisible();
      expect(errors, `${route.path} 에서 렌더 오류`).toEqual([]);
    });
  }
});

test.describe('인증', () => {
  test('로그인하지 않으면 로그인 화면으로 보낸다', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/approvals');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();
  });

  test('초대 링크로 왔다가 로그인하면 그 링크로 돌아간다', async ({ page, account }) => {
    await page.context().clearCookies();
    const next = '/invitations/some-token';
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByPlaceholder('you@company.com').fill(account.email);
    await page.getByPlaceholder('********').fill(account.password);
    await page.getByRole('button', { name: '로그인' }).click();
    // 돌아갈 곳을 잃으면 초대받은 사람이 링크를 다시 열어야 한다.
    await page.waitForURL((url) => url.pathname === next);
  });

  test('외부 주소로는 돌려보내지 않는다', async ({ page, account }) => {
    await page.context().clearCookies();
    await page.goto('/login?next=https://example.com/steal');
    await page.getByPlaceholder('you@company.com').fill(account.email);
    await page.getByPlaceholder('********').fill(account.password);
    await page.getByRole('button', { name: '로그인' }).click();
    // 오픈 리다이렉트가 되면 로그인 직후 남이 만든 페이지로 간다.
    // `/login` 자체도 localhost이므로 "로그인 화면을 벗어났는가"로 기다려야 한다.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    expect(page.url()).not.toContain('example.com');
    expect(new URL(page.url()).hostname).toBe('localhost');
  });
});
