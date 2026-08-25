'use client';

import Link from 'next/link';
import { api, contextReduction, type TraceListResponse } from '@/lib/api';
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
} from '@/components/ui';

const STATUS_TONE = {
  OPEN: 'pending',
  COMPLETED: 'active',
  FAILED: 'deny',
  CANCELLED: 'locked',
} as const;

export default function TracesPage() {
  const orgId = useOrgId();
  const traces = useResource<TraceListResponse>(
    () => api<TraceListResponse>(`/organizations/${orgId}/traces`),
    [orgId],
  );

  return (
    <>
      <PageHeader
        title="Traces"
        description="외부 AI의 업무 흐름 하나를 시간순으로 재구성합니다."
      />

      {traces.loading ? (
        <LoadingState label="흐름 불러오는 중" />
      ) : traces.error ? (
        <ErrorState
          title="흐름을 불러오지 못했습니다"
          statusCode={traces.error.statusCode || undefined}
          message={traces.error.message}
          onRetry={traces.reload}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="작업 흐름"
              description={`${traces.data?.traces.length ?? 0}건`}
            />
            {!traces.data || traces.data.traces.length === 0 ? (
              <EmptyState
                title="기록된 흐름이 없습니다"
                hint="에이전트가 company.resolve_task를 호출하면 흐름이 시작됩니다."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-3xl text-sm">
                  <thead>
                    <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                      <th className="px-4 py-2 font-medium">작업</th>
                      <th className="px-4 py-2 font-medium">사용자</th>
                      <th className="px-4 py-2 font-medium">Client</th>
                      <th className="px-4 py-2 font-medium">Context</th>
                      <th className="px-4 py-2 font-medium">이벤트</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.data.traces.map((trace) => {
                      const reduction = contextReduction(
                        trace.candidateAssetCount,
                        trace.selectedAssetCount,
                      );
                      return (
                        <tr key={trace.id} className="border-t border-border hover:bg-surface-hover">
                          <td className="px-4 py-2.5">
                            <Link href={`/traces/${trace.id}`} className="block">
                              <span className="block truncate font-medium text-fg">
                                {trace.purpose}
                              </span>
                              <span className="block font-mono text-2xs text-fg-subtle">
                                {new Date(trace.startedAt).toLocaleString('ko-KR')}
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-fg-muted">{trace.userDisplayName}</td>
                          <td className="px-4 py-2.5">
                            <span className="block font-mono text-xs text-fg-muted">
                              {trace.clientName ?? '—'}
                            </span>
                            {trace.modelName ? (
                              <span
                                className="block font-mono text-2xs text-fg-subtle"
                                title={
                                  trace.modelSource === 'CLIENT_REPORTED'
                                    ? '클라이언트가 보고한 값이며 서버가 검증하지 않습니다'
                                    : undefined
                                }
                              >
                                {trace.modelName}
                                {trace.modelSource === 'CLIENT_REPORTED' ? ' (자가 보고)' : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                            {trace.candidateAssetCount === null ? (
                              '—'
                            ) : (
                              <>
                                {trace.candidateAssetCount} → {trace.selectedAssetCount}
                                {/* 분모가 0이면 계산하지 않는다. 0%로 표시하면 거짓이다. */}
                                {reduction === null ? '' : ` (−${reduction}%)`}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">
                            {trace.eventCount}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={STATUS_TONE[trace.status]}>{trace.status}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="흐름 없는 이벤트"
              description="traceId 없이 들어온 기록입니다. 어느 흐름인지 추측하지 않습니다."
            />
            {!traces.data || traces.data.untracked.length === 0 ? (
              <EmptyState title="흐름 없는 이벤트가 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {traces.data.untracked.slice(0, 20).map((event) => (
                  <li key={event.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="font-mono text-xs text-fg-muted">{event.eventType}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                      {event.actorDisplayName ?? '—'}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                      {new Date(event.createdAt).toLocaleString('ko-KR')}
                    </span>
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
