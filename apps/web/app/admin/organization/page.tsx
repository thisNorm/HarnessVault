'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api, del, post, type OrgMember, type Organization } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId, useSession } from '@/components/session';
import { Invitations } from '@/components/invitations';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MemberTable,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

export default function OrganizationPage() {
  const orgId = useOrgId();
  const { session } = useSession();
  const org = useResource<{ organization: Organization }>(
    () => api(`/organizations/${orgId}`),
    [orgId],
  );
  const members = useResource<{ members: OrgMember[] }>(
    () => api(`/organizations/${orgId}/members`),
    [orgId],
  );
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      members.reload();
      session.reload();
    } catch (err: unknown) {
      setActionError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    await run(() =>
      post(`/organizations/${orgId}/members`, {
        email: String(data.get('email')),
        role: String(data.get('role')),
      }),
    );
    setPending(false);
    form.reset();
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId);
    await run(() => del(`/organizations/${orgId}/members/${userId}`));
    setBusyUserId(null);
  }

  return (
    <>
      <PageHeader title="조직" description="조직 정보와 Organization 멤버를 관리합니다." />

      <Card className="mb-5">
        <CardHeader title="조직 정보" />
        {org.loading ? (
          <LoadingState />
        ) : org.error ? (
          <ErrorState
            title="조직 정보를 불러오지 못했습니다"
            statusCode={org.error.statusCode || undefined}
            message={org.error.message}
            onRetry={org.reload}
          />
        ) : org.data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 px-4 py-3.5 text-sm">
            <dt className="text-fg-subtle">이름</dt>
            <dd className="font-medium">{org.data.organization.name}</dd>
            <dt className="text-fg-subtle">Slug</dt>
            <dd className="font-mono text-xs text-fg-muted">{org.data.organization.slug}</dd>
            <dt className="text-fg-subtle">Organization ID</dt>
            <dd className="font-mono text-xs text-fg-muted">{org.data.organization.id}</dd>
            <dt className="text-fg-subtle">상태</dt>
            <dd>
              <StatusBadge status="ACTIVE" />
            </dd>
          </dl>
        ) : null}
      </Card>

      <div className="mb-5">
        <Invitations orgId={orgId} />
      </div>

      <Card>
        <CardHeader
          title="멤버"
          description="Organization 단위 Role을 부여합니다."
          action={
            <span className="text-2xs text-fg-subtle">
              {members.data ? `${members.data.members.length}명` : ''}
            </span>
          }
        />

        <form onSubmit={addMember} className="flex items-end gap-2.5 border-b border-line px-4 py-3">
          <div className="w-72">
            <Field label="이메일">
              <Input name="email" type="email" required placeholder="member@company.com" />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Role">
              <Input name="role" required placeholder="ORG_MEMBER" />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '추가 중…' : '멤버 추가'}
          </Button>
        </form>

        {actionError ? (
          <ErrorState
            title="요청이 실패했습니다"
            statusCode={actionError.statusCode || undefined}
            message={actionError.message}
          />
        ) : null}

        {members.loading ? (
          <LoadingState />
        ) : members.error ? (
          <ErrorState
            title="멤버 목록을 불러오지 못했습니다"
            statusCode={members.error.statusCode || undefined}
            message={members.error.message}
            onRetry={members.reload}
          />
        ) : !members.data || members.data.members.length === 0 ? (
          <EmptyState title="멤버가 없습니다" hint="위에서 이메일로 멤버를 추가하세요." />
        ) : (
          <MemberTable
            members={members.data.members}
            busyUserId={busyUserId}
            onRemove={removeMember}
          />
        )}
      </Card>
    </>
  );
}

