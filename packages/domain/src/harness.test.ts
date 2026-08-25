import { describe, expect, it } from 'vitest';
import {
  assetKeySchema,
  assetSelectorSchema,
  assetVersionSchema,
  canTransitionAsset,
  canTransitionAssetVersion,
  estimateTokens,
} from './harness';

describe('assetKeySchema', () => {
  it('점으로 계층을 나눈 key를 받는다', () => {
    expect(assetKeySchema.safeParse('db.troubleshoot.core').success).toBe(true);
    expect(assetKeySchema.safeParse('mqtt.ingestion.diagnose').success).toBe(true);
    expect(assetKeySchema.safeParse('verify-before-completion').success).toBe(true);
  });

  it('대문자·공백·연속 구분자를 거부한다', () => {
    for (const bad of ['DB.core', 'db core', 'db..core', '.db', 'db.', 'db-.core']) {
      expect(assetKeySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('assetVersionSchema', () => {
  it('1.3 · 1.3.0 형태를 받는다', () => {
    expect(assetVersionSchema.safeParse('1.3').success).toBe(true);
    expect(assetVersionSchema.safeParse('2.0.1').success).toBe(true);
  });

  it('v 접두사나 한 자리 버전을 거부한다', () => {
    for (const bad of ['v1.3', '1', '1.', 'latest']) {
      expect(assetVersionSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('assetSelectorSchema', () => {
  it('빈 selector는 조건 없음을 뜻한다', () => {
    expect(assetSelectorSchema.parse({})).toEqual({});
  });

  it('알 수 없는 키를 거부한다 — 오타가 조용히 통과하면 Resolver가 틀린다', () => {
    expect(assetSelectorSchema.safeParse({ database: ['postgresql'] }).success).toBe(false);
    expect(assetSelectorSchema.safeParse({ databases: ['postgresql'] }).success).toBe(true);
  });
});

describe('자산 라이프사이클', () => {
  it('DRAFT → ACTIVE → DEPRECATED → ARCHIVED를 허용한다', () => {
    expect(canTransitionAsset('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransitionAsset('ACTIVE', 'DEPRECATED')).toBe(true);
    expect(canTransitionAsset('DEPRECATED', 'ARCHIVED')).toBe(true);
  });

  it('되돌리는 전이를 막는다', () => {
    expect(canTransitionAsset('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransitionAsset('DEPRECATED', 'ACTIVE')).toBe(false);
    expect(canTransitionAsset('ACTIVE', 'DRAFT')).toBe(false);
  });

  it('건너뛰는 전이를 막는다', () => {
    expect(canTransitionAsset('DRAFT', 'DEPRECATED')).toBe(false);
  });
});

describe('버전 라이프사이클', () => {
  it('DRAFT → CANDIDATE → ACTIVE → SUPERSEDED를 허용한다', () => {
    expect(canTransitionAssetVersion('DRAFT', 'CANDIDATE')).toBe(true);
    expect(canTransitionAssetVersion('CANDIDATE', 'ACTIVE')).toBe(true);
    expect(canTransitionAssetVersion('ACTIVE', 'SUPERSEDED')).toBe(true);
  });

  it('CANDIDATE는 DRAFT로 되돌릴 수 있다 — 아직 활성이 아니었기 때문이다', () => {
    expect(canTransitionAssetVersion('CANDIDATE', 'DRAFT')).toBe(true);
  });

  it('DRAFT에서 바로 ACTIVE로 올릴 수 없다', () => {
    expect(canTransitionAssetVersion('DRAFT', 'ACTIVE')).toBe(false);
  });

  it('SUPERSEDED를 되살릴 수 없다', () => {
    expect(canTransitionAssetVersion('SUPERSEDED', 'ACTIVE')).toBe(false);
    expect(canTransitionAssetVersion('ARCHIVED', 'ACTIVE')).toBe(false);
  });
});

describe('estimateTokens', () => {
  it('라틴 문자는 대략 4문자당 1토큰으로 잡는다', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('한글은 문자당 1토큰에 가깝게 잡는다', () => {
    expect(estimateTokens('가나다라')).toBe(4);
  });

  it('빈 문자열은 0이다', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('섞인 문장도 단조 증가한다', () => {
    const short = estimateTokens('DB 장애');
    const long = estimateTokens('DB 장애 분석 절차를 확인한다');
    expect(long).toBeGreaterThan(short);
  });
});
