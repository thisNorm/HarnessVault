import { describe, expect, it } from 'vitest';
import { orgLabel } from './org-label';

const acme = { id: '1', name: 'Acme', slug: 'acme-one' };
const acmeToo = { id: '2', name: 'Acme', slug: 'acme-two' };
const other = { id: '3', name: 'Other', slug: 'other' };

describe('orgLabel', () => {
  it('겹치지 않으면 이름만 쓴다', () => {
    expect(orgLabel(other, [acme, other])).toBe('Other');
  });

  it('이름이 겹치면 slug를 붙인다', () => {
    // 안 붙이면 선택기에 똑같은 항목이 여러 개 보인다.
    expect(orgLabel(acme, [acme, acmeToo])).toBe('Acme (acme-one)');
    expect(orgLabel(acmeToo, [acme, acmeToo])).toBe('Acme (acme-two)');
  });

  it('자기 자신은 중복으로 세지 않는다', () => {
    expect(orgLabel(acme, [acme])).toBe('Acme');
  });

  it('셋 이상 겹쳐도 각각 구분된다', () => {
    const third = { id: '4', name: 'Acme', slug: 'acme-three' };
    const all = [acme, acmeToo, third];
    expect(new Set(all.map((o) => orgLabel(o, all))).size).toBe(3);
  });
});
