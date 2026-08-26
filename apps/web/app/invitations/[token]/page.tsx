'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, post, type InvitationPreview } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { Badge, Button, Card, CardHeader, ErrorState, LoadingState } from '@/components/ui';

const STATUS_MESSAGE = {
  ACCEPTED: '이미 수락된 초대입니다.',
  REVOKED: '철회된 초대입니다. 관리자에게 새 링크를 요청하세요.',
  EXPIRED: '만료된 초대입니다. 관리자에게 새 링크를 요청하세요.',
} as const;

/**
 * 초대 수락 화면.
 *
 * 로그인이 필요하다 — 초대 링크가 가입 절차를 대신하지 않는다.
 * 로그인하지 않았으면 `/login`으로 보내되, 돌아올 곳을 넘긴다.
 */
export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  const preview = useResource<InvitationPreview>(
    async () =>
      (await api<{ invitation: InvitationPreview }>(`/invitations/${token}`)).invitation,
    [token],
  );

  async function accept() {
    setError(null);
    setPending(true);
    try {
      await post(`/invitations/${token}/accept`, {});
      router.push('/approvals');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
      setPending(false);
    }
  }

  if (preview.loading) return <LoadingState label="초대 확인 중" />;

  // 로그인하지 않았으면 여기로 돌아올 수 있게 목적지를 넘긴다.
  if (preview.error?.statusCode === 401) {
    return (
      <Card>
        <CardHeader title="로그인이 필요합니다" description="초대를 수락하려면 먼저 로그인하세요." />
        <div className="flex gap-2 px-4 py-3">
          <Button
            variant="primary"
            onClick={() => router.push(`/login?next=${encodeURIComponent(`/invitations/${token}`)}`)}
          >
            로그인
          </Button>
          <Button
            onClick={() =>
              router.push(`/register?next=${encodeURIComponent(`/invitations/${token}`)}`)
            }
          >
            계정 만들기
          </Button>
        </div>
      </Card>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <ErrorState
        title="초대를 확인할 수 없습니다"
        statusCode={preview.error?.statusCode || undefined}
        message={preview.error?.message ?? '초대를 찾을 수 없습니다'}
      />
    );
  }

  const invitation = preview.data;
  const blocked = invitation.status !== 'PENDING';

  return (
    <Card>
      <CardHeader
        title={`${invitation.organizationName}에 초대되었습니다`}
        description="수락하면 이 조직의 Harness와 자산에 접근할 수 있습니다."
      />
      <dl className="divide-y divide-border text-sm">
        <div className="flex items-center justify-between px-4 py-2.5">
          <dt className="text-2xs tracking-wide text-fg-subtle uppercase">조직</dt>
          <dd className="text-fg">{invitation.organizationName}</dd>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <dt className="text-2xs tracking-wide text-fg-subtle uppercase">Role</dt>
          <dd className="font-mono text-xs">{invitation.role}</dd>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <dt className="text-2xs tracking-wide text-fg-subtle uppercase">유효 기간</dt>
          <dd className="font-mono text-xs">
            {new Date(invitation.expiresAt).toLocaleString('ko-KR')}
          </dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {blocked ? (
          <>
            <Badge tone="locked">{invitation.status}</Badge>
            <span className="text-xs text-fg-muted">
              {STATUS_MESSAGE[invitation.status as keyof typeof STATUS_MESSAGE]}
            </span>
          </>
        ) : (
          <Button variant="primary" disabled={pending} onClick={accept}>
            {pending ? '수락 중…' : '초대 수락'}
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState
          title="수락하지 못했습니다"
          statusCode={error.statusCode || undefined}
          message={error.message}
        />
      ) : null}
    </Card>
  );
}
