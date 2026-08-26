'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api, post, type CuratorRunView } from '@/lib/api';
import { Badge, Button } from '@/components/ui';

const VERDICT_TONE = {
  DUPLICATE: 'pending',
  VARIANT_OF: 'accent',
  IMPROVEMENT_ON: 'active',
  CONFLICTS_WITH: 'deny',
  NEW: 'active',
  UNKNOWN: 'locked',
} as const;

const VERDICT_LABEL = {
  DUPLICATE: '기존 자산과 같음',
  VARIANT_OF: '조건만 다른 변종',
  IMPROVEMENT_ON: '기존 자산 개선',
  CONFLICTS_WITH: '기존 자산과 상충',
  NEW: '새로운 지식',
  UNKNOWN: '판단하지 못함',
} as const;

/**
 * Curator 결과 패널.
 *
 * 여기 표시되는 것은 전부 **추천이다.** 어떤 판정도 기여 상태를 바꾸지 않는다 —
 * 승격·거절은 검토자가 아래 버튼으로 직접 한다.
 */
export function CuratorPanel({
  orgId,
  contributionId,
}: {
  orgId: string;
  contributionId: string;
}) {
  const [runs, setRuns] = useState<CuratorRunView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await api<{ runs: CuratorRunView[] }>(
        `/organizations/${orgId}/contributions/${contributionId}/curator`,
      );
      setRuns(result.runs);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function review() {
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ run: CuratorRunView }>(
        `/organizations/${orgId}/contributions/${contributionId}/curator`,
        {},
      );
      setRuns((prev) => [result.run, ...(prev ?? [])]);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const latest = runs?.[0];

  return (
    <div className="mt-3 rounded-sm border border-border bg-bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">
          Curator
        </span>
        <Button disabled={busy} onClick={review}>
          {busy ? '검토 중…' : latest ? '다시 검토' : '검토 실행'}
        </Button>
        {runs === null ? (
          <button
            type="button"
            onClick={load}
            className="text-2xs text-fg-subtle hover:text-fg"
          >
            이전 검토 보기
          </button>
        ) : null}
        <span className="ml-auto text-2xs text-fg-subtle">
          {/* 판정은 참고일 뿐이라는 사실을 화면에서 지운 적이 없어야 한다. */}
          판정은 추천입니다. 승격·거절은 사람이 합니다
        </span>
      </div>

      {error ? <p className="mt-2 text-xs text-state-deny">{error}</p> : null}

      {latest ? <RunView run={latest} /> : null}

      {runs && runs.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-2xs text-fg-subtle hover:text-fg">
            이전 검토 {runs.length - 1}건
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {runs.slice(1).map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-2xs text-fg-subtle">
                <span className="font-mono">
                  {new Date(run.createdAt).toLocaleString('ko-KR')}
                </span>
                <span>{run.status === 'FAILED' ? run.failureCode : run.verdict}</span>
                <span>{run.provider}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function RunView({ run }: { run: CuratorRunView }) {
  if (run.status === 'FAILED') {
    return (
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="deny">{run.failureCode ?? 'FAILED'}</Badge>
          <span className="text-xs text-fg-muted">{run.failureMessage}</span>
        </div>
        {/* Curator가 없어도 사람은 판단할 수 있어야 한다(§61). */}
        <p className="mt-1 text-2xs text-fg-subtle">
          Curator 없이도 승격·거절은 그대로 할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={VERDICT_TONE[run.verdict ?? 'UNKNOWN']}>
          {VERDICT_LABEL[run.verdict ?? 'UNKNOWN']}
        </Badge>
        {run.relatedAssetKey ? (
          run.relatedAssetId ? (
            <Link
              href={`/assets/${run.relatedAssetId}`}
              className="font-mono text-2xs text-accent hover:underline"
            >
              {run.relatedAssetKey}
            </Link>
          ) : (
            // 모델이 지목한 key가 실제 자산과 맞지 않았다. 감추지 않는다.
            <span
              className="font-mono text-2xs text-fg-subtle"
              title="모델이 지목했지만 실제 자산과 연결되지 않았습니다"
            >
              {run.relatedAssetKey} (미확인)
            </span>
          )
        ) : null}
        {run.confidence !== null ? (
          <span className="text-2xs text-fg-subtle">확신도 {run.confidence.toFixed(2)}</span>
        ) : null}
      </div>

      {run.reasoning ? <p className="mt-1.5 text-xs text-fg-muted">{run.reasoning}</p> : null}

      {run.suggestedValidations.length > 0 ? (
        <div className="mt-1.5">
          <span className="text-2xs text-fg-subtle">검증 제안</span>
          <ul className="mt-0.5 list-disc pl-4 text-xs text-fg-muted">
            {run.suggestedValidations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-subtle">
        {run.provider === 'MOCK' ? (
          // Mock이 성공인 척하면 안 된다(§72). 화면에서도 밝힌다.
          <span className="text-state-pending" title="실제 모델이 아니라 유사도만 본 결과입니다">
            실제 모델이 판단한 것이 아닙니다 (MOCK)
          </span>
        ) : (
          <span>모델 {run.model}</span>
        )}
        <span>복잡도 {run.complexity}</span>
        <span>{run.roundsUsed}라운드</span>
        <span>{(run.durationMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
