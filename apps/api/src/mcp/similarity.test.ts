import { describe, expect, it } from 'vitest';
import { jaccard, rankAssets, scoreAsset, tokenize } from './similarity';

describe('tokenize', () => {
  it('한글과 영문을 함께 자른다', () => {
    expect(tokenize('DB 장애 분석 troubleshoot')).toEqual(['db', '장애', '분석', 'troubleshoot']);
  });

  it('구분자와 한 글자 토큰을 버린다', () => {
    expect(tokenize('db.troubleshoot.core')).toEqual(['db', 'troubleshoot', 'core']);
    expect(tokenize('a b cd')).toEqual(['cd']);
  });

  it('대소문자를 통일한다', () => {
    expect(tokenize('PostgreSQL')).toEqual(tokenize('postgresql'));
  });
});

describe('jaccard', () => {
  it('완전히 같으면 1이다', () => {
    expect(jaccard(['db', '장애'], ['db', '장애'])).toBe(1);
  });

  it('겹치지 않으면 0이다', () => {
    expect(jaccard(['db'], ['mqtt'])).toBe(0);
  });

  it('빈 입력은 0이다', () => {
    expect(jaccard([], ['db'])).toBe(0);
    expect(jaccard(['db'], [])).toBe(0);
  });

  it('부분 겹침은 0과 1 사이다', () => {
    const score = jaccard(['db', '장애'], ['db', '복구']);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('순서가 달라도 같다', () => {
    expect(jaccard(['a2', 'b2'], ['b2', 'a2'])).toBe(1);
  });
});

describe('scoreAsset', () => {
  const asset = {
    key: 'db.troubleshoot.core',
    name: 'DB 장애 진단 핵심',
    description: 'DB 장애 원인 분석 절차',
    capabilityId: 'cap-db',
  };

  it('관련 있는 질의에 점수를 준다', () => {
    expect(scoreAsset(asset, { text: 'DB 장애 분석' })).toBeGreaterThan(0);
  });

  it('무관한 질의는 0이다', () => {
    expect(scoreAsset(asset, { text: 'MQTT 브로커 연결' })).toBe(0);
  });

  it('같은 Capability면 가산점을 준다', () => {
    const without = scoreAsset(asset, { text: 'DB 장애' });
    const with_ = scoreAsset(asset, { text: 'DB 장애', capabilityId: 'cap-db' });
    expect(with_).toBeGreaterThan(without);
  });

  it('다른 Capability는 가산점이 없다', () => {
    expect(scoreAsset(asset, { text: 'DB 장애', capabilityId: 'cap-mqtt' })).toBe(
      scoreAsset(asset, { text: 'DB 장애' }),
    );
  });

  it('1을 넘지 않는다', () => {
    expect(scoreAsset(asset, { text: asset.key + ' ' + asset.name + ' ' + asset.description, capabilityId: 'cap-db' })).toBeLessThanOrEqual(1);
  });
});

describe('rankAssets', () => {
  const assets = [
    { key: 'z.db.core', name: 'DB 장애', description: '', capabilityId: null },
    { key: 'a.db.core', name: 'DB 장애', description: '', capabilityId: null },
    { key: 'mqtt.flow', name: 'MQTT 진단', description: '', capabilityId: null },
  ];

  it('점수 0인 자산을 빼고 준다', () => {
    const ranked = rankAssets(assets, { text: 'DB 장애' }, 10);
    expect(ranked.map((item) => item.key)).not.toContain('mqtt.flow');
  });

  it('동점이면 key 오름차순으로 정렬한다 — 결정론', () => {
    const ranked = rankAssets(assets, { text: 'DB 장애' }, 10);
    expect(ranked.map((item) => item.key)).toEqual(['a.db.core', 'z.db.core']);
  });

  it('limit을 지킨다', () => {
    expect(rankAssets(assets, { text: 'DB 장애' }, 1)).toHaveLength(1);
  });

  it('결과에 점수를 함께 담는다', () => {
    const ranked = rankAssets(assets, { text: 'DB 장애' }, 1);
    expect(typeof ranked[0]?.score).toBe('number');
  });
});
