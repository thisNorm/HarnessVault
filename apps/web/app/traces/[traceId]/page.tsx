'use client';

import { use } from 'react';
import Link from 'next/link';
import { api, contextReduction, type TraceDetail } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  type Tone,
} from '@/components/ui';

const STATUS_TONE = {
  OPEN: 'warn',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'neutral',
} as const;

/** 이벤트 종류별 색. 승인·거부처럼 사람이 개입한 지점이 눈에 띄어야 한다. */
const EVENT_TONE: Record<string, Tone> = {
  'harness.resolved': 'accent',
  'harness.compiled': 'accent',
  'harness.resolution_conflict': 'danger',
  'policy.evaluated': 'neutral',
  'resource.accessed': 'accent',
  'resource.access_failed': 'danger',
  'approval.requested': 'warn',
  'approval.decided': 'ok',
  'approval.executed': 'ok',
  'approval.failed': 'danger',
  'task.completed': 'ok',
};

export default function TraceDetailPage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = use(params);
  const orgId = useOrgId();
  const trace = useResource<TraceDetail>(
    async () =>
      (await api<{ trace: TraceDetail }>(`/organizations/${orgId}/traces/${traceId}`)).trace,
    [orgId, traceId],
  );

  if (trace.loading) return <LoadingState label="흐름 불러오는 중" />;
  if (trace.error) {
    return (
      <ErrorState
        title="흐름을 불러오지 못했습니다"
        statusCode={trace.error.statusCode || undefined}
        message={trace.error.message}
        onRetry={trace.reload}
      />
    );
  }
  if (!trace.data) return <EmptyState title="흐름이 없습니다" />;

  const item = trace.data;
  const reduction = contextReduction(item.candidateAssetCount, item.selectedAssetCount);
  const startedAt = new Date(item.startedAt).getTime();

  return (
    <>
      <Link href="/traces" className="mb-3 inline-block text-xs text-fg-muted hover:text-fg">
        ← Traces
      </Link>
      <PageHeader title={item.purpose} description={`trace ${item.id}`} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="타임라인" description={`${item.events.length}개 이벤트 · 시간순`} />
          {item.events.length === 0 ? (
            <EmptyState title="기록된 이벤트가 없습니다" />
          ) : (
            <ol className="px-4 py-3">
              {item.events.map((event, index) => {
                const at = new Date(event.createdAt);
                const elapsed = Math.max(0, at.getTime() - startedAt);
                return (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {/* 세로선 — 마지막 항목에는 그리지 않는다. */}
                    {index < item.events.length - 1 ? (
                      <span
                        className="absolute top-4 left-[5px] h-full w-px bg-border"
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className={`relative z-10 mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-bg ${
                        EVENT_TONE[event.eventType] === 'danger'
                          ? 'bg-danger'
                          : EVENT_TONE[event.eventType] === 'warn'
                            ? 'bg-warn'
                            : EVENT_TONE[event.eventType] === 'ok'
                              ? 'bg-ok'
                              : 'bg-accent'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-2xs text-fg-subtle">
                          {at.toLocaleTimeString('ko-KR')}
                        </span>
                        <span className="font-mono text-2xs text-fg-subtle">
                          +{(elapsed / 1000).toFixed(1)}s
                        </span>
                        <Badge tone={EVENT_TONE[event.eventType] ?? 'accent'}>
                          {event.eventType}
                        </Badge>
                        {event.actorDisplayName ? (
                          <span className="text-xs text-fg-muted">{event.actorDisplayName}</span>
                        ) : null}
                      </div>
                      <EventDetail metadata={event.metadata} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="h-fit">
            <CardHeader title="흐름 정보" />
            <dl className="divide-y divide-line text-sm">
              <Row label="Status">
                <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
              </Row>
              <Row label="User">
                <span className="text-fg">{item.userDisplayName}</span>
              </Row>
              <Row label="Project">
                <span className="text-xs">{item.projectName ?? '—'}</span>
              </Row>
              <Row label="Client">
                <span className="font-mono text-xs">
                  {item.clientName ?? '—'}
                  {item.clientVersion ? ` ${item.clientVersion}` : ''}
                </span>
              </Row>
              <Row label="Model">
                {item.modelName ? (
                  <>
                    <span className="block font-mono text-xs">{item.modelName}</span>
                    {/* 서버가 검증하지 않는다(§59). */}
                    <span className="block text-2xs text-fg-subtle">
                      {item.modelSource === 'CLIENT_REPORTED' ? '클라이언트 자가 보고' : item.modelSource}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-fg-subtle">알 수 없음</span>
                )}
              </Row>
              <Row label="시작">
                <span className="font-mono text-2xs">
                  {new Date(item.startedAt).toLocaleString('ko-KR')}
                </span>
              </Row>
              <Row label="종료">
                <span className="font-mono text-2xs">
                  {item.completedAt ? new Date(item.completedAt).toLocaleString('ko-KR') : '—'}
                </span>
              </Row>
              {item.summary ? (
                <Row label="요약">
                  <span className="text-xs text-fg-muted">{item.summary}</span>
                </Row>
              ) : null}
              <Row label="산출물 계약">
                {item.outputContractSatisfied === null ? (
                  <span className="text-xs text-fg-subtle">—</span>
                ) : item.outputContractSatisfied ? (
                  <Badge tone="ok">충족</Badge>
                ) : (
                  <>
                    <Badge tone="danger">미충족</Badge>
                    {/* 빠진 사실을 감추지 않는다. 계약이 장식이 되지 않게 한다. */}
                    <span className="mt-1 block font-mono text-2xs text-fg-subtle">
                      {(item.missingOutputFields ?? []).join(', ')}
                    </span>
                  </>
                )}
              </Row>
            </dl>
          </Card>

          <Card className="h-fit">
            <CardHeader title="Context 효율" description="전부 추정치입니다" />
            <dl className="divide-y divide-line text-sm">
              <Row label="후보 → 선택">
                <span className="font-mono text-xs">
                  {item.candidateAssetCount === null
                    ? '—'
                    : `${item.candidateAssetCount} → ${item.selectedAssetCount}`}
                </span>
              </Row>
              <Row label="감축">
                {/* 분모가 0이면 계산하지 않는다. */}
                <span className="font-mono text-xs">
                  {reduction === null ? '—' : `${reduction}%`}
                </span>
              </Row>
              <Row label="가용 추정">
                <span className="font-mono text-xs">
                  {item.estimatedAvailableTokens === null
                    ? '제한 없음'
                    : `~${item.estimatedAvailableTokens}`}
                </span>
              </Row>
              <Row label="주입 추정">
                <span className="font-mono text-xs">
                  {item.estimatedInjectedTokens === null ? '—' : `~${item.estimatedInjectedTokens}`}
                </span>
              </Row>
            </dl>
          </Card>

          <Card className="h-fit">
            <CardHeader title="토큰" description="갈래마다 신뢰도가 다릅니다" />
            <dl className="divide-y divide-line text-sm">
              <Row label="Harness (추정)">
                <span className="font-mono text-xs">
                  {item.harnessInputTokens === null ? '—' : `~${item.harnessInputTokens}`}
                </span>
              </Row>
              <Row label="Curator (실측)">
                <span className="font-mono text-xs">
                  {item.curatorInputTokens === null ? '—' : item.curatorInputTokens}
                </span>
              </Row>
              <Row label="Client 보고">
                {/* 모르면 "알 수 없음"이다. 0으로 바꾸지 않는다(§40). */}
                <span className="font-mono text-xs">
                  {item.clientReportedInputTokens === null
                    ? '알 수 없음'
                    : `in ${item.clientReportedInputTokens} / out ${item.clientReportedOutputTokens ?? '?'}`}
                </span>
              </Row>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** 감사에는 원문이 없다(§39). 지문·개수·이름만 보여준다. */
function EventDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  if (entries.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.slice(0, 8).map(([key, value]) => (
        <span
          key={key}
          className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
        >
          {key}: {typeof value === 'object' ? JSON.stringify(value).slice(0, 60) : String(value).slice(0, 60)}
        </span>
      ))}
    </div>
  );
}
