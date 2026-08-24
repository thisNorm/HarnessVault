'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  del,
  post,
  type OrgMember,
  type Scope,
  type ScopeMember,
} from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from './session';
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
  Select,
} from './ui';

export type ScopeKind = 'teams' | 'projects' | 'groups';

const CONFIG = {
  teams: {
    title: '팀',
    description: 'Team을 만들고 Organization 멤버를 배치합니다.',
    memberRoles: null,
    withTeam: false,
  },
  projects: {
    title: '프로젝트',
    description: 'Project를 만들고 Project Role로 멤버를 배치합니다.',
    memberRoles: ['PROJECT_OWNER', 'PROJECT_LEAD', 'PROJECT_MEMBER'],
    withTeam: true,
  },
  groups: {
    title: '그룹',
    description: 'Group을 만들고 Organization 멤버를 배치합니다.',
    memberRoles: null,
    withTeam: false,
  },
} satisfies Record<
  ScopeKind,
  { title: string; description: string; memberRoles: string[] | null; withTeam: boolean }
>;

export function ScopeAdmin({ kind }: { kind: ScopeKind }) {
  const config = CONFIG[kind];
  const orgId = useOrgId();
  const base = `/organizations/${orgId}/${kind}`;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const list = useResource<Scope[]>(
    async () => (await api<Record<string, Scope[]>>(base))[kind] ?? [],
    [base, kind],
  );
  const members = useResource<ScopeMember[]>(
    selectedId
      ? async () =>
          (await api<Record<string, ScopeMember[]>>(`${base}/${selectedId}/members`)).members ?? []
      : null,
    [base, selectedId],
  );

  // 조직 멤버 중에서 고르게 한다. UUID를 직접 치게 하면 콘솔이 쓸모없어진다.
  const orgMembers = useResource<OrgMember[]>(
    async () =>
      (await api<Record<string, OrgMember[]>>(`/organizations/${orgId}/members`)).members ?? [],
    [orgId],
  );

  // 프로젝트는 Team에 연결될 수 있다. UUID를 직접 치게 하지 않고 목록에서 고르게 한다.
  const teams = useResource<Scope[]>(
    config.withTeam
      ? async () =>
          (await api<Record<string, Scope[]>>(`/organizations/${orgId}/teams`)).teams ?? []
      : null,
    [orgId, config.withTeam],
  );

  const selected = list.data?.find((item) => item.id === selectedId) ?? null;

  const assignedIds = new Set((members.data ?? []).map((member) => member.userId));
  const assignable = (orgMembers.data ?? []).filter(
    (candidate) => !assignedIds.has(candidate.userId),
  );

  async function run(fn: () => Promise<unknown>, reload: () => void) {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err: unknown) {
      setActionError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    }
  }

  function reloadMembers() {
    members.reload();
    list.reload();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const teamId = String(data.get('teamId') ?? '').trim();
    setPending(true);
    await run(
      () =>
        post(base, {
          name: String(data.get('name')),
          slug: String(data.get('slug')),
          ...(config.withTeam && teamId ? { teamId } : {}),
        }),
      list.reload,
    );
    setPending(false);
    form.reset();
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const role = data.get('role');
    setPending(true);
    await run(
      () =>
        post(`${base}/${selectedId}/members`, {
          userId: String(data.get('userId')),
          ...(role ? { role: String(role) } : {}),
        }),
      reloadMembers,
    );
    setPending(false);
    form.reset();
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId);
    await run(() => del(`${base}/${selectedId}/members/${userId}`), reloadMembers);
    setBusyUserId(null);
  }

  return (
    <>
      <PageHeader title={config.title} description={config.description} />

      {actionError ? (
        <div className="mb-4 -mt-1">
          <ErrorState
            title="요청이 실패했습니다"
            statusCode={actionError.statusCode || undefined}
            message={actionError.message}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={`${config.title} 목록`}
            action={
              <span className="text-2xs text-fg-subtle">
                {list.data ? `${list.data.length}개` : ''}
              </span>
            }
          />

          <form onSubmit={create} className="flex flex-col gap-2.5 border-b border-border px-4 py-3">
            <Field label="이름">
              <Input name="name" required placeholder={`${config.title} 이름`} />
            </Field>
            <Field label="Slug">
              <Input name="slug" required pattern="[a-z0-9-]+" placeholder="platform-core" />
            </Field>
            {config.withTeam ? (
              <Field label="Team (선택)">
                <Select name="teamId" defaultValue="">
                  <option value="">Team 없이 생성</option>
                  {(teams.data ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Button type="submit" variant="primary" disabled={pending} className="mt-1 self-start">
              {pending ? '처리 중…' : `${config.title} 생성`}
            </Button>
          </form>

          {list.loading ? (
            <LoadingState />
          ) : list.error ? (
            <ErrorState
              title={`${config.title} 목록을 불러오지 못했습니다`}
              statusCode={list.error.statusCode || undefined}
              message={list.error.message}
              onRetry={list.reload}
            />
          ) : !list.data || list.data.length === 0 ? (
            <EmptyState
              title={`${config.title}이(가) 없습니다`}
              hint={`위 폼으로 첫 ${config.title}을(를) 만드세요.`}
            />
          ) : (
            <ul>
              {list.data.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id} className="border-t border-border">
                    <button
                      onClick={() => setSelectedId(item.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                        active ? 'bg-accent-soft' : 'hover:bg-surface-hover'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">
                          {item.name}
                        </span>
                        <span className="block truncate font-mono text-xs text-fg-subtle">
                          {item.slug}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-fg-muted">{item.memberCount}명</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="멤버"
            description={
              selected
                ? `${selected.name} · ${selected.slug}`
                : `${config.title}을(를) 선택하면 멤버를 관리할 수 있습니다.`
            }
          />

          {!selectedId ? (
            <EmptyState title={`선택된 ${config.title}이(가) 없습니다`} />
          ) : (
            <>
              <form
                onSubmit={addMember}
                className="flex items-end gap-2.5 border-b border-border px-4 py-3"
              >
                <div className="w-72">
                  <Field label="사용자">
                    <Select name="userId" required defaultValue="">
                      <option value="" disabled>
                        조직 멤버 선택
                      </option>
                      {assignable.map((candidate) => (
                        <option key={candidate.userId} value={candidate.userId}>
                          {candidate.displayName} · {candidate.email}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {config.memberRoles ? (
                  <div className="w-56">
                    <Field label="Role">
                      <Select name="role" required defaultValue="PROJECT_MEMBER">
                        {config.memberRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ) : null}
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? '추가 중…' : '멤버 배치'}
                </Button>
              </form>

              {members.loading ? (
                <LoadingState />
              ) : members.error ? (
                <ErrorState
                  title="멤버 목록을 불러오지 못했습니다"
                  statusCode={members.error.statusCode || undefined}
                  message={members.error.message}
                  onRetry={members.reload}
                />
              ) : !members.data || members.data.length === 0 ? (
                <EmptyState title="배치된 멤버가 없습니다" hint="User ID로 멤버를 배치하세요." />
              ) : (
                <MemberTable
                  members={members.data}
                  busyUserId={busyUserId}
                  onRemove={removeMember}
                />
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
