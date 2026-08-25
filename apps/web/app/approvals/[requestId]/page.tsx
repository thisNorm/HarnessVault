'use client';

import { use, useState } from 'react';
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
  Input,
  LoadingState,
  PageHeader,
} from '@/components/ui';

const STATUS_TONE = {
  PENDING: 'pending',
  APPROVED: 'active',
  EXECUTING: 'pending',
  EXECUTED: 'active',
  REJECTED: 'deny',
  FAILED: 'deny',
  EXPIRED: 'locked',
  CANCELLED: 'locked',
} as const;

export default function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = use(params);
  const orgId = useOrgId();
  const approval = useResource<ApprovalRequestView>(
    async () =>
      (await api<{ approval: ApprovalRequestView }>(`/organizations/${orgId}/approvals/${requestId}`))
        .approval,
    [orgId, requestId],
  );

  const [comment, setComment] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(verdict: 'approve' | 'reject') {
    setError(null);
    setPending(true);
    try {
      await post(`/organizations/${orgId}/approvals/${requestId}/${verdict}`, { comment });
      setComment('');
      approval.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  if (approval.loading) return <LoadingState label="승인 요청 불러오는 중" />;
  if (approval.error) {
    return (
      <ErrorState
        title="승인 요청을 불러오지 못했습니다"
        statusCode={approval.error.statusCode || undefined}
        message={approval.error.message}
        onRetry={approval.reload}
      />
    );
  }
  if (!approval.data) return <EmptyState title="요청이 없습니다" />;

  const item = approval.data;

  return (
    <>
      <Link href="/approvals" className="mb-3 inline-block text-xs text-fg-muted hover:text-fg">
        ← 승인함
      </Link>
      <PageHeader
        title={`${item.resourceName} · ${item.action}`}
        description={`요청 ${item.id}`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="변경 내용" description="승인하면 이 내용 그대로 실행됩니다" />
            <pre className="overflow-x-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-fg">
              {item.proposedChange}
            </pre>
          </Card>

          <Card>
            <CardHeader title="요청 근거" />
            <dl className="divide-y divide-border">
              <Block label="Reason" value={item.reason} required />
              <Block label="Risk" value={item.risk} />
              <Block label="Rollback" value={item.rollbackPlan} />
              <Block label="Verification" value={item.verificationPlan} />
            </dl>
          </Card>

          {item.status === 'PENDING' ? (
            <Card>
              <CardHeader
                title="판단"
                description={
                  item.canDecide
                    ? '승인하면 요청자가 실행할 수 있게 됩니다.'
                    : '이 요청의 승인자가 아니거나 이미 판단했습니다.'
                }
              />
              <div className="flex flex-col gap-2.5 px-4 py-3">
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="의견 (선택)"
                  disabled={!item.canDecide}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={!item.canDecide || pending}
                    onClick={() => decide('approve')}
                  >
                    승인
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!item.canDecide || pending}
                    onClick={() => decide('reject')}
                  >
                    거부
                  </Button>
                </div>
              </div>
              {error ? (
                <ErrorState
                  title="판단을 기록하지 못했습니다"
                  statusCode={error.statusCode || undefined}
                  message={error.message}
                />
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="판단 기록" description={`${item.decisions.length}건`} />
            {item.decisions.length === 0 ? (
              <EmptyState title="아직 판단이 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {item.decisions.map((decision) => (
                  <li key={decision.userId} className="flex items-start gap-3 px-4 py-2.5">
                    <Badge tone={decision.decision === 'APPROVE' ? 'active' : 'deny'}>
                      {decision.decision}
                    </Badge>
                    <div className="min-w-0">
                      <span className="block text-sm text-fg">{decision.displayName}</span>
                      {decision.comment ? (
                        <span className="block text-xs text-fg-muted">{decision.comment}</span>
                      ) : null}
                    </div>
                    <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">
                      {new Date(decision.decidedAt).toLocaleString('ko-KR')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="요청 정보" />
          <dl className="divide-y divide-border text-sm">
            <Row label="Status">
              <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            </Row>
            <Row label="Requester">
              <span className="block text-fg">{item.requester.displayName}</span>
              <span className="block font-mono text-xs text-fg-subtle">{item.requester.email}</span>
            </Row>
            <Row label="Client">
              <span className="font-mono text-xs">{item.clientName ?? '—'}</span>
            </Row>
            <Row label="Model">
              {item.clientReportedModel ? (
                <>
                  <span className="block font-mono text-xs">{item.clientReportedModel}</span>
                  {/* 서버가 검증하지 않는다(§59). 그 사실을 숨기지 않는다. */}
                  <span className="block text-2xs text-fg-subtle">클라이언트 자가 보고</span>
                </>
              ) : (
                <span className="text-xs text-fg-subtle">알 수 없음</span>
              )}
            </Row>
            <Row label="Project">
              <span className="text-xs">{item.projectName ?? '—'}</span>
            </Row>
            <Row label="Resource">
              <span className="block text-fg">{item.resourceName}</span>
              <Badge tone="locked">{item.resourceClassification}</Badge>
            </Row>
            <Row label="Action">
              <Badge tone="deny">{item.action}</Badge>
            </Row>
            <Row label="승인 정책">
              <span className="block text-xs">{item.approvalPolicyName ?? '—'}</span>
              {item.mode ? (
                <span className="block font-mono text-2xs text-fg-subtle">
                  {item.mode}
                  {item.requiredCount ? ` (${item.requiredCount})` : ''}
                </span>
              ) : null}
            </Row>
            <Row label="요구한 Policy">
              {/* 왜 승인이 필요한지 사람이 알아야 한다(§55). */}
              <span className="font-mono text-2xs break-all text-fg-subtle">
                {item.policyIds.join(', ') || '—'}
              </span>
            </Row>
            <Row label="만료">
              <span className="text-xs">
                {item.expiresAt ? new Date(item.expiresAt).toLocaleString('ko-KR') : '—'}
              </span>
            </Row>
            {item.failureReason ? (
              <Row label="실패 사유">
                <span className="text-xs text-state-deny">{item.failureReason}</span>
              </Row>
            ) : null}
          </dl>
        </Card>
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

function Block({
  label,
  value,
  required,
}: {
  label: string;
  value: string | null;
  required?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-fg-muted">
        {value ? (
          value
        ) : (
          // 비어 있음을 드러낸다. 없는 것을 있는 것처럼 보이게 하지 않는다.
          <span className={required ? 'text-state-deny' : 'text-fg-subtle'}>
            {required ? '누락 — 필수 항목입니다' : '작성되지 않음'}
          </span>
        )}
      </dd>
    </div>
  );
}
