'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api, del, post, type InvitationView, type IssuedInvitation } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
} from '@/components/ui';

const STATUS_TONE = {
  PENDING: 'warn',
  ACCEPTED: 'ok',
  REVOKED: 'neutral',
  EXPIRED: 'neutral',
} as const;

const STATUS_LABEL = {
  PENDING: '대기 중',
  ACCEPTED: '수락됨',
  REVOKED: '철회됨',
  EXPIRED: '만료됨',
} as const;

/**
 * 초대 관리.
 *
 * 메일을 보내지 않는다 — 링크를 만드는 것까지가 서버의 일이고 전달은 사람이 한다.
 * 그래서 생성 직후 링크를 크게 보여주고, **한 번만 볼 수 있다는 사실**을 함께 알린다.
 */
export function Invitations({ orgId }: { orgId: string }) {
  const invitations = useResource<InvitationView[]>(
    async () =>
      (await api<{ invitations: InvitationView[] }>(`/organizations/${orgId}/invitations`))
        .invitations,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setPending(true);
    try {
      const result = await post<{ invitation: IssuedInvitation }>(
        `/organizations/${orgId}/invitations`,
        {
          email: String(data.get('email')),
          role: String(data.get('role')),
          expiresInHours: Number(data.get('expiresInHours')),
        },
      );
      setIssued(result.invitation);
      setCopied(false);
      form.reset();
      invitations.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  async function revoke(invitationId: string) {
    setError(null);
    try {
      await del(`/organizations/${orgId}/invitations/${invitationId}`);
      invitations.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    }
  }

  const link = issued
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/invitations/${issued.token}`
    : '';

  return (
    <Card>
      <CardHeader
        title="초대"
        description="아직 가입하지 않은 사람을 부를 때 씁니다. 메일은 보내지 않으니 링크를 직접 전달하세요."
        action={
          <span className="text-2xs text-fg-subtle">
            {invitations.data ? `${invitations.data.length}건` : ''}
          </span>
        }
      />

      <form onSubmit={invite} className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
        <div className="w-72">
          <Field label="이메일">
            <Input name="email" type="email" required placeholder="newcomer@company.com" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Role">
            <Select name="role" defaultValue="ORG_MEMBER">
              <option value="ORG_MEMBER">ORG_MEMBER</option>
              <option value="ORG_ADMIN">ORG_ADMIN</option>
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="유효 기간">
            <Select name="expiresInHours" defaultValue="168">
              <option value="24">1일</option>
              <option value="168">7일</option>
              <option value="720">30일</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '만드는 중…' : '초대 링크 만들기'}
        </Button>
      </form>

      {issued ? (
        <div className="border-b border-line bg-surface-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">링크 생성됨</Badge>
            <span className="text-xs text-fg-muted">{issued.email}</span>
            {/* 원문을 저장하지 않으므로 정말로 다시 볼 수 없다. 숨기지 않고 말한다. */}
            <span className="ml-auto text-2xs text-warn">
              이 링크는 지금만 볼 수 있습니다. 닫으면 다시 만들어야 합니다
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-sm border border-line bg-bg px-2 py-1.5 font-mono text-xs text-fg">
              {link}
            </code>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? '복사됨' : '복사'}
            </Button>
            <Button onClick={() => setIssued(null)}>닫기</Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorState
          title="요청이 실패했습니다"
          statusCode={error.statusCode || undefined}
          message={error.message}
        />
      ) : null}

      {invitations.loading ? (
        <LoadingState />
      ) : invitations.error ? (
        <ErrorState
          title="초대 목록을 불러오지 못했습니다"
          statusCode={invitations.error.statusCode || undefined}
          message={invitations.error.message}
          onRetry={invitations.reload}
        />
      ) : (invitations.data ?? []).length === 0 ? (
        <EmptyState title="아직 초대가 없습니다" />
      ) : (
        <ul className="divide-y divide-line">
          {(invitations.data ?? []).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.email}</span>
              <span className="font-mono text-2xs text-fg-subtle">{item.role}</span>
              {item.status === 'ACCEPTED' && item.acceptedByEmail !== item.email ? (
                // 초대한 이메일과 수락한 사람이 다르면 반드시 드러낸다.
                <span
                  className="text-2xs text-warn"
                  title="초대한 이메일과 다른 계정이 수락했습니다"
                >
                  {item.acceptedByEmail}(이) 수락
                </span>
              ) : null}
              <span className="text-2xs text-fg-subtle">
                {item.status === 'PENDING'
                  ? `${new Date(item.expiresAt).toLocaleDateString('ko-KR')}까지`
                  : new Date(item.createdAt).toLocaleDateString('ko-KR')}
              </span>
              {item.status === 'PENDING' ? (
                <Button variant="danger" onClick={() => revoke(item.id)}>
                  철회
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
