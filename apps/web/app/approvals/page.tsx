'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, api, post, type ApprovalRequestView } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusRail,
} from '@/components/ui';

const STATUS_TONE = {
  PENDING: 'warn',
  APPROVED: 'ok',
  EXECUTING: 'warn',
  EXECUTED: 'ok',
  REJECTED: 'danger',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
} as const;

export default function ApprovalsPage() {
  const orgId = useOrgId();
  const approvals = useResource<ApprovalRequestView[]>(
    async () =>
      (await api<{ approvals: ApprovalRequestView[] }>(`/organizations/${orgId}/approvals`))
        .approvals,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(requestId: string, verdict: 'approve' | 'reject') {
    setError(null);
    setBusyId(requestId);
    try {
      await post(`/organizations/${orgId}/approvals/${requestId}/${verdict}`, { comment: '' });
      approvals.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setBusyId(null);
    }
  }

  const pending = (approvals.data ?? []).filter((item) => item.status === 'PENDING');
  const rest = (approvals.data ?? []).filter((item) => item.status !== 'PENDING');

  return (
    <>
      <PageHeader
        title="승인함"
        description="사람이 판단해야 진행되는 요청입니다. 에이전트가 승인받았다고 주장해도 서버 상태만 신뢰합니다."
      />

      {error ? (
        <div className="mb-4">
          <ErrorState
            title="판단을 기록하지 못했습니다"
            statusCode={error.statusCode || undefined}
            message={error.message}
          />
        </div>
      ) : null}

      {approvals.loading ? (
        <LoadingState label="승인 요청 불러오는 중" />
      ) : approvals.error ? (
        <ErrorState
          title="승인 요청을 불러오지 못했습니다"
          statusCode={approvals.error.statusCode || undefined}
          message={approvals.error.message}
          onRetry={approvals.reload}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="대기 중" count={pending.length} />
            {pending.length === 0 ? (
              <EmptyState title="대기 중인 요청이 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((item) => (
                  <li key={item.id} className="relative px-4 py-3.5 pl-5">
                    {/* 상태를 좌측 레일로 표시한다. 줄마다 배지를 반복하는 것보다 훑기 쉽다. */}
                    <StatusRail tone={STATUS_TONE[item.status]} />
                    <RequestSummary item={item} />
                    <div className="mt-3 flex items-center gap-2">
                      {item.canDecide ? (
                        <>
                          <Button
                            variant="primary"
                            disabled={busyId === item.id}
                            onClick={() => decide(item.id, 'approve')}
                          >
                            승인
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busyId === item.id}
                            onClick={() => decide(item.id, 'reject')}
                          >
                            거부
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-fg-subtle">
                          {/* 왜 못 누르는지 알려준다. 버튼만 없으면 사용자는 이유를 모른다. */}
                          이 요청의 승인자가 아니거나 이미 판단했습니다
                        </span>
                      )}
                      <Link
                        href={`/approvals/${item.id}`}
                        className="ml-auto text-xs text-fg-muted hover:text-fg"
                      >
                        자세히 →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="처리됨" count={rest.length} />
            {rest.length === 0 ? (
              <EmptyState title="처리된 요청이 없습니다" />
            ) : (
              <ul className="divide-y divide-line">
                {rest.slice(0, 30).map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                      {item.resourceName} · {item.action}
                    </span>
                    <Link
                      href={`/approvals/${item.id}`}
                      className="shrink-0 text-xs text-fg-subtle hover:text-fg"
                    >
                      자세히
                    </Link>
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

function RequestSummary({ item }: { item: ApprovalRequestView }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
        <Badge tone="neutral">{item.action}</Badge>
        <span className="font-medium text-fg">{item.resourceName}</span>
        <Badge tone="neutral">{item.resourceClassification}</Badge>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{item.reason}</p>
      <pre className="mt-2 overflow-x-auto rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-fg-muted">
        {item.proposedChange}
      </pre>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-subtle">
        <span>요청자 {item.requester.displayName}</span>
        {item.clientName ? <span>Client {item.clientName}</span> : null}
        {item.clientReportedModel ? (
          // 클라이언트가 스스로 보고한 값이다(§59).
          <span title="클라이언트가 보고한 값이며 서버가 검증하지 않습니다">
            Model {item.clientReportedModel} (자가 보고)
          </span>
        ) : null}
        {item.projectName ? <span>Project {item.projectName}</span> : null}
        {item.approvalPolicyName ? <span>승인 정책 {item.approvalPolicyName}</span> : null}
      </div>
    </>
  );
}
