import { createOrg, expect, signIn, test } from './fixtures';

/**
 * 조직 컨텍스트 회귀 방지.
 *
 * 두 결함 모두 브라우저를 열기 전까지 아무도 몰랐다.
 * 서버는 정상이었고 API e2e는 전부 통과하고 있었다.
 */

test.describe('조직 선택', () => {
  test('이동해도 새로고침해도 유지된다', async ({ page, request, account }) => {
    const stamp = Date.now();
    await createOrg(request, '첫 번째 조직', `ctx-first-${stamp}`);
    await createOrg(request, '두 번째 조직', `ctx-second-${stamp}`);

    await signIn(page, account);
    await page.goto('/admin/organization');

    const selector = page.getByLabel('조직 선택');
    // 목록이 채워지기 전에 읽으면 옵션이 모자란 채로 통과하거나 실패한다.
    // 개수를 기다리는 단언을 먼저 걸어 경쟁을 없앤다.
    await expect(selector.locator('option')).toHaveCount(2);

    // **기본값이 아닌 것**을 고른다. 목록 순서를 가정하고 고르면 되돌아가도
    // 같은 값이라 테스트가 우연히 통과한다 — 실제로 그렇게 한 번 속았다.
    const values = await selector.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    const initial = await selector.inputValue();
    const target = values.find((value) => value !== initial);
    expect(target, '조직이 둘 이상이어야 한다').toBeTruthy();

    await selector.selectOption(target!);
    await expect(selector).toHaveValue(target!);

    // 라우트 그룹을 넘어간다. Provider가 다시 마운트되는 지점이다 —
    // 여기서 기본 조직으로 돌아가면 사용자는 모른 채 남의 조직 데이터를 본다.
    await page.goto('/resolve');
    await expect(selector).toHaveValue(target!);

    await page.goto('/assets');
    await expect(selector).toHaveValue(target!);

    // 새로고침도 견뎌야 한다. React state만으로는 여기서 초기화된다.
    await page.reload();
    await expect(selector).toHaveValue(target!);
  });

  test('이름이 같으면 slug로 구분된다', async ({ page, request, account }) => {
    const stamp = Date.now();
    await createOrg(request, '같은 이름', `dup-a-${stamp}`);
    await createOrg(request, '같은 이름', `dup-b-${stamp}`);

    await signIn(page, account);
    await page.goto('/admin/organization');

    const optionLocator = page.getByLabel('조직 선택').locator('option');
    // 목록이 채워질 때까지 기다린다. 바로 읽으면 흔들린다.
    await expect(optionLocator).toHaveCount(2);
    const options = await optionLocator.allTextContents();
    const duplicated = options.filter((label) => label.startsWith('같은 이름'));
    expect(duplicated).toHaveLength(2);
    // 붙이지 않으면 선택기에 똑같은 항목이 둘 보이고 무엇을 고르는지 알 수 없다.
    expect(duplicated).toContain(`같은 이름 (dup-a-${stamp})`);
    expect(duplicated).toContain(`같은 이름 (dup-b-${stamp})`);
    expect(new Set(duplicated).size).toBe(2);
  });

  test('이름이 겹치지 않으면 slug를 붙이지 않는다', async ({ page, request, account }) => {
    const stamp = Date.now();
    await createOrg(request, '유일한 이름', `uniq-a-${stamp}`);
    await createOrg(request, '다른 이름', `uniq-b-${stamp}`);

    await signIn(page, account);
    await page.goto('/admin/organization');

    const optionLocator = page.getByLabel('조직 선택').locator('option');
    await expect(optionLocator).toHaveCount(2);
    const options = await optionLocator.allTextContents();
    // 매번 slug를 달면 목록이 소음이 된다.
    expect(options).toContain('유일한 이름');
    expect(options).toContain('다른 이름');
  });
});
