'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api, post, type ContributionSummary } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
} from '@/components/ui';

const STATUS_TONE = {
  CANDIDATE: 'pending',
  PROMOTED: 'active',
  REJECTED: 'deny',
  WITHDRAWN: 'locked',
} as const;

export default function CandidatesPage() {
  const orgId = useOrgId();
  const contributions = useResource<ContributionSummary[]>(
    async () =>
      (await api<{ contributions: ContributionSummary[] }>(`/organizations/${orgId}/contributions`))
        .contributions,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(id: string, verdict: 'promote' | 'reject') {
    setError(null);
    setBusyId(id);
    try {
      await post(`/organizations/${orgId}/contributions/${id}/${verdict}`, {
        note: notes[id] ?? '',
      });
      contributions.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusyId(null);
    }
  }

  const waiting = (contributions.data ?? []).filter((item) => item.status === 'CANDIDATE');
  const decided = (contributions.data ?? []).filter((item) => item.status !== 'CANDIDATE');

  return (
    <>
      <PageHeader
        title="Candidates"
        description="에이전트가 제출한 지식입니다. 사람이 승격해야 조직 자산이 됩니다 — 자동 승격은 없습니다."
      />

      {error ? (
        <div className="mb-4">
          <ErrorState
            title="처리하지 못했습니다"
            statusCode={error.statusCode || undefined}
            message={error.message}
          />
        </div>
      ) : null}

      {contributions.loading ? (
        <LoadingState label="기여 불러오는 중" />
      ) : contributions.error ? (
        <ErrorState
          title="기여를 불러오지 못했습니다"
          statusCode={contributions.error.statusCode || undefined}
          message={contributions.error.message}
          onRetry={contributions.reload}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="검토 대기" description={`${waiting.length}건`} />
            {waiting.length === 0 ? (
              <EmptyState title="검토할 기여가 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {waiting.map((item) => (
                  <li key={item.id} className="px-4 py-4">
                    <Summary item={item} />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        placeholder="검토 의견 (거절에는 필수)"
                        className="min-w-0 flex-1"
                        value={notes[item.id] ?? ''}
                        onChange={(event) =>
                          setNotes((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                      />
                      <Button
                        variant="primary"
                        disabled={busyId === item.id}
                        onClick={() => decide(item.id, 'promote')}
                      >
                        승격
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busyId === item.id}
                        onClick={() => decide(item.id, 'reject')}
                      >
                        거절
                      </Button>
                    </div>
                    {item.duplicateOfAssetId ? (
                      <p className="mt-2 text-2xs text-fg-subtle">
                        {/* 중복이어도 막지 않는다. 기존 자산이 틀렸다는 기여일 수 있다. */}
                        승격하면 새 자산이 생깁니다. 기존 자산의 새 버전으로 받으려면 자산 화면에서
                        버전을 추가하세요.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="처리됨" description={`${decided.length}건`} />
            {decided.length === 0 ? (
              <EmptyState title="처리된 기여가 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {decided.slice(0, 30).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                      {item.name}
                    </span>
                    {item.reviewNote ? (
                      <span className="max-w-[40%] truncate text-2xs text-fg-subtle">
                        {item.reviewNote}
                      </span>
                    ) : null}
                    {item.promotedAssetId ? (
                      <Link
                        href={`/assets/${item.promotedAssetId}`}
                        className="shrink-0 text-xs text-fg-subtle hover:text-fg"
                      >
                        자산 보기
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Summary({ item }: { item: ContributionSummary }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
        <Badge tone="accent">{item.type}</Badge>
        <span className="font-medium text-fg">{item.name}</span>
        <code className="font-mono text-2xs text-fg-subtle">{item.proposedKey}</code>
      </div>
      {item.description ? <p className="mt-2 text-sm text-fg-muted">{item.description}</p> : null}
      {item.rationale ? (
        <p className="mt-1 text-xs text-fg-subtle">제출 이유 — {item.rationale}</p>
      ) : null}

      {item.duplicateOfAssetId ? (
        <div className="mt-2 rounded-sm border border-state-pending/40 bg-bg-raised px-3 py-2 text-xs text-fg-muted">
          비슷한 자산이 이미 있습니다 (유사도{' '}
          {item.duplicateScore === null ? '?' : item.duplicateScore.toFixed(2)} ·{' '}
          {item.similarityMethod === 'VECTOR' ? '의미 검색' : '어휘 검색'}){' '}
          <Link
            href={`/assets/${item.duplicateOfAssetId}`}
            className="text-accent hover:underline"
          >
            확인
          </Link>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-subtle">
        <span>제출자 {item.submittedByDisplayName}</span>
        <span>제안 범위 {item.proposedScopeType}</span>
        {item.traceId ? (
          <Link href={`/traces/${item.traceId}`} className="hover:text-fg">
            흐름 보기
          </Link>
        ) : null}
        {/* 어휘 검색으로 돌았으면 그 사실을 숨기지 않는다. */}
        {item.embeddingStatus !== 'OK' ? (
          <span title="임베딩 제공자가 없거나 실패해 어휘 기반으로 중복을 찾았습니다">
            중복 탐색 {item.similarityMethod}
          </span>
        ) : null}
      </div>
    </>
  );
}
