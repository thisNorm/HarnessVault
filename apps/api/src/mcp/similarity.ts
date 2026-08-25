/**
 * 어휘 기반 유사도. Phase 5의 `find_similar`·`search_asset` 순위에 쓴다.
 *
 * pgvector 의미 검색은 Phase 11이다. 그때까지 의미 검색인 척하지 않는다 —
 * 응답에 `method: 'LEXICAL'`을 실어 호출자가 무엇을 받았는지 알게 한다.
 */

/** 한글·영문·숫자만 남기고 자른다. 형태소 분석은 하지 않는다. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/u)
    .filter((token) => token.length > 1);
}

/**
 * Jaccard 유사도 — 두 집합의 교집합 / 합집합.
 * 길이가 크게 다른 문서에 관대하지 않다는 한계가 있지만,
 * 자산 제목·설명처럼 짧은 텍스트에서는 충분하고 결과가 결정론적이다.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared++;
  }
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface ScorableAsset {
  key: string;
  name: string;
  description: string;
  capabilityId: string | null;
}

export interface ScoreQuery {
  text: string;
  capabilityId?: string | null;
}

/**
 * 0~1 점수. 같은 Capability면 가산점을 준다 —
 * 조직이 이미 "같은 능력"으로 묶어 둔 것은 사람이 남긴 신호이므로 어휘 겹침보다 신뢰할 만하다.
 */
export function scoreAsset(asset: ScorableAsset, query: ScoreQuery): number {
  const queryTokens = tokenize(query.text);
  const assetTokens = tokenize(`${asset.key} ${asset.name} ${asset.description}`);
  let score = jaccard(queryTokens, assetTokens);

  if (query.capabilityId && asset.capabilityId === query.capabilityId) {
    score = Math.min(1, score + 0.25);
  }
  // 소수점 셋째 자리까지만 남긴다. 부동소수 꼬리 때문에 정렬이 흔들리지 않게 한다.
  return Math.round(score * 1000) / 1000;
}

export function rankAssets<T extends ScorableAsset>(
  assets: readonly T[],
  query: ScoreQuery,
  limit: number,
): Array<T & { score: number }> {
  return assets
    .map((asset) => ({ ...asset, score: scoreAsset(asset, query) }))
    .filter((item) => item.score > 0)
    // 동점이면 key로 정렬해 결정론을 지킨다.
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit);
}
