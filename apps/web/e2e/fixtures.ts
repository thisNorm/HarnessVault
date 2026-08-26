import { randomBytes } from 'node:crypto';
import { test as base, type APIRequestContext, type Page } from '@playwright/test';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export interface Account {
  email: string;
  password: string;
  displayName: string;
}

export function makeAccount(displayName: string): Account {
  return {
    email: `pw-${randomBytes(6).toString('hex')}@example.com`,
    password: randomBytes(18).toString('base64url'),
    displayName,
  };
}

/**
 * 준비는 API로 한다. 조직·자산을 화면으로 만들면 그 화면이 깨졌을 때
 * 무관한 테스트가 전부 같이 죽어 원인을 못 찾는다.
 */
export async function registerAndLogin(request: APIRequestContext, account: Account) {
  await request.post(`${API_URL}/auth/register`, { data: account });
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: account.email, password: account.password },
  });
  const raw = (res.headers()['set-cookie'] ?? '')
    .split('\n')
    .find((c) => c.startsWith('harness_session='));
  const token = raw?.split('=')[1]?.split(';')[0] ?? '';
  const me = await (await request.get(`${API_URL}/auth/me`)).json();
  return { token, userId: me.user.id as string };
}

export async function createOrg(request: APIRequestContext, name: string, slug: string) {
  const res = await request.post(`${API_URL}/organizations`, { data: { name, slug } });
  const body = await res.json();
  return body.organization.id as string;
}

/** 브라우저에 세션 쿠키를 심는다. 매 테스트마다 로그인 화면을 거치지 않게 한다. */
export async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(account.email);
  await page.getByPlaceholder('********').fill(account.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export const test = base.extend<{ account: Account }>({
  account: async ({ request }, use) => {
    const account = makeAccount('Playwright 사용자');
    await registerAndLogin(request, account);
    await use(account);
  },
});

export { expect } from '@playwright/test';
