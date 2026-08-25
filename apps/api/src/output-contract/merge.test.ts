import { describe, expect, it } from 'vitest';
import {
  type OutputContractCandidate,
  checkOutputAgainstContract,
  mergeOutputContracts,
  outputFieldSchema,
} from '@harnessvault/domain';

function contract(
  id: string,
  scopeType: OutputContractCandidate['scopeType'],
  fields: string[],
): OutputContractCandidate {
  return { id, name: `${scopeType} 계약`, scopeType, fields };
}

describe('outputFieldSchema', () => {
  it('lowerCamelCase를 받는다', () => {
    for (const good of ['summary', 'changedFiles', 'dbIngestionCheck', 'step2Result']) {
      expect(outputFieldSchema.safeParse(good).success, good).toBe(true);
    }
  });

  it('대소문자만 다른 항목이 갈라지지 않게 형식을 강제한다', () => {
    for (const bad of ['Summary', 'changed_files', 'changed-files', 'CHANGEDFILES', 'a', '1step']) {
      expect(outputFieldSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('mergeOutputContracts', () => {
  const company = contract('c1', 'COMPANY', ['summary', 'verification', 'unresolved']);
  const team = contract('t1', 'TEAM', ['changedFiles', 'testResults']);
  const project = contract('p1', 'PROJECT', ['mqttVerification', 'dbIngestionCheck']);

  it('세 스코프를 합집합으로 병합한다', () => {
    const merged = mergeOutputContracts([company, team, project]);
    expect(merged.requiredFields).toHaveLength(7);
    expect(merged.requiredFields).toContain('summary');
    expect(merged.requiredFields).toContain('changedFiles');
    expect(merged.requiredFields).toContain('dbIngestionCheck');
  });

  it('덜 구체적인 스코프의 항목이 앞에 온다', () => {
    const merged = mergeOutputContracts([project, team, company]);
    expect(merged.requiredFields.slice(0, 3)).toEqual(['summary', 'verification', 'unresolved']);
  });

  it('입력 순서를 바꿔도 결과가 같다 — 결정론', () => {
    expect(JSON.stringify(mergeOutputContracts([company, team, project]))).toBe(
      JSON.stringify(mergeOutputContracts([project, company, team])),
    );
  });

  it('하위 스코프는 상위 항목을 지울 수 없다', () => {
    // 계약에 "제거" 표현 자체가 없다. 무엇을 넣어도 상위 항목은 남는다.
    const merged = mergeOutputContracts([company, contract('t2', 'TEAM', ['onlyThis'])]);
    expect(merged.requiredFields).toContain('summary');
    expect(merged.requiredFields).toContain('onlyThis');
  });

  it('중복 항목의 출처는 덜 구체적인 스코프다', () => {
    // 회사가 먼저 요구한 것의 출처가 팀으로 바뀌면 "왜 필요한가"를 거꾸로 읽게 된다.
    const merged = mergeOutputContracts([company, contract('t3', 'TEAM', ['summary'])]);
    expect(merged.sourceMap.summary?.scope).toBe('COMPANY');
    expect(merged.requiredFields.filter((f) => f === 'summary')).toHaveLength(1);
  });

  it('각 항목의 출처를 남긴다', () => {
    const merged = mergeOutputContracts([company, team]);
    expect(merged.sourceMap.changedFiles?.scope).toBe('TEAM');
    expect(merged.sourceMap.changedFiles?.sourceId).toBe('t1');
  });

  it('계약이 없으면 빈 목록이다 — null이 아니다', () => {
    const merged = mergeOutputContracts([]);
    expect(merged.requiredFields).toEqual([]);
    expect(merged.sourceMap).toEqual({});
  });

  it('기여한 계약 목록을 남긴다', () => {
    const merged = mergeOutputContracts([company, team]);
    expect(merged.contributingContracts.map((c) => c.id)).toEqual(['c1', 't1']);
  });
});

describe('checkOutputAgainstContract', () => {
  const merged = mergeOutputContracts([
    contract('c1', 'COMPANY', ['summary', 'verification']),
    contract('t1', 'TEAM', ['changedFiles']),
  ]);

  it('모두 채우면 satisfied다', () => {
    const result = checkOutputAgainstContract(merged, {
      summary: '요약',
      verification: '검증 완료',
      changedFiles: ['a.ts'],
    });
    expect(result.satisfied).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('빠진 항목을 알려준다', () => {
    const result = checkOutputAgainstContract(merged, { summary: '요약' });
    expect(result.satisfied).toBe(false);
    expect(result.missingFields).toEqual(['verification', 'changedFiles']);
  });

  it('빈 문자열은 채운 것으로 보지 않는다', () => {
    // 형식만 맞춘 산출물을 통과시키면 계약이 장식이 된다.
    const result = checkOutputAgainstContract(merged, {
      summary: '   ',
      verification: '검증',
      changedFiles: ['a.ts'],
    });
    expect(result.missingFields).toEqual(['summary']);
  });

  it('빈 배열도 채운 것으로 보지 않는다', () => {
    const result = checkOutputAgainstContract(merged, {
      summary: '요약',
      verification: '검증',
      changedFiles: [],
    });
    expect(result.missingFields).toEqual(['changedFiles']);
  });

  it('0과 false는 채운 값으로 본다', () => {
    // 유효한 값이다. 빈 값과 구분해야 한다.
    const zeroContract = mergeOutputContracts([contract('c', 'COMPANY', ['errorCount', 'hasRisk'])]);
    const result = checkOutputAgainstContract(zeroContract, { errorCount: 0, hasRisk: false });
    expect(result.satisfied).toBe(true);
  });

  it('산출물을 아예 안 주면 전부 빠진 것이다', () => {
    expect(checkOutputAgainstContract(merged, null).missingFields).toHaveLength(3);
  });

  it('계약이 비어 있으면 무엇을 줘도 satisfied다', () => {
    expect(checkOutputAgainstContract(mergeOutputContracts([]), {}).satisfied).toBe(true);
  });
});
