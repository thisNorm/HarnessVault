'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api, post, type ResourceSummary } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
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
  PageHeader,
  Select,
} from '@/components/ui';

const TYPES = ['FILE_SYSTEM', 'DATABASE', 'GIT', 'INTERNAL_API'] as const;
const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'HIGHLY_RESTRICTED'] as const;

const CLASSIFICATION_TONE = {
  PUBLIC: 'ok',
  INTERNAL: 'accent',
  RESTRICTED: 'warn',
  HIGHLY_RESTRICTED: 'danger',
} as const;

interface Team {
  id: string;
  name: string;
}

export default function ResourcesPage() {
  const orgId = useOrgId();
  const resources = useResource<ResourceSummary[]>(
    async () =>
      (await api<{ resources: ResourceSummary[] }>(`/organizations/${orgId}/resources`)).resources,
    [orgId],
  );
  const teams = useResource<Team[]>(
    async () => (await api<{ teams: Team[] }>(`/organizations/${orgId}/teams`)).teams,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [type, setType] = useState<string>('FILE_SYSTEM');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const root = String(data.get('root') ?? '').trim();
    const credentialRef = String(data.get('credentialRef') ?? '').trim();

    setError(null);
    setPending(true);
    try {
      await post(`/organizations/${orgId}/resources`, {
        type,
        name: String(data.get('name')),
        classification: String(data.get('classification')),
        ownerType: 'TEAM',
        ownerId: String(data.get('ownerId')),
        adapterType: type.toLowerCase(),
        config: root ? { root } : {},
        credentialRef: credentialRef || null,
      });
      resources.reload();
      form.reset();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Resources"
        description="회사 파일·DB·Git을 등록합니다. 접속 정보는 저장하지 않고 환경변수 이름만 담습니다."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Resource 추가"
            description="credentialRef는 HARNESS_RESOURCE_로 시작하는 환경변수 이름입니다. 값 자체는 저장되지 않습니다."
          />
          <form onSubmit={create} className="flex flex-wrap items-end gap-2.5 px-4 py-3">
            <div className="w-40">
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-40 flex-1">
              <Field label="이름">
                <Input name="name" required placeholder="운영 문서" />
              </Field>
            </div>
            <div className="w-44">
              <Field label="등급">
                <Select name="classification" defaultValue="INTERNAL">
                  {CLASSIFICATIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="소유 팀">
                <Select name="ownerId" required defaultValue="">
                  <option value="" disabled>
                    팀 선택
                  </option>
                  {(teams.data ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {type === 'FILE_SYSTEM' || type === 'GIT' ? (
              <div className="min-w-52 flex-1">
                <Field label="root 경로">
                  <Input name="root" required placeholder="/srv/docs" />
                </Field>
              </div>
            ) : null}
            {type === 'DATABASE' || type === 'INTERNAL_API' ? (
              <div className="min-w-52 flex-1">
                <Field label="credentialRef">
                  <Input name="credentialRef" required placeholder="HARNESS_RESOURCE_MAIN_DB" />
                </Field>
              </div>
            ) : null}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? '추가 중…' : 'Resource 추가'}
            </Button>
          </form>
          {error ? (
            <ErrorState
              title="Resource를 만들지 못했습니다"
              statusCode={error.statusCode || undefined}
              message={error.message}
            />
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Resource 목록"
            count={resources.data?.length}
          />
          {resources.loading ? (
            <LoadingState />
          ) : resources.error ? (
            <ErrorState
              title="Resource를 불러오지 못했습니다"
              statusCode={resources.error.statusCode || undefined}
              message={resources.error.message}
              onRetry={resources.reload}
            />
          ) : !resources.data || resources.data.length === 0 ? (
            <EmptyState title="등록된 Resource가 없습니다" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl text-sm">
                <thead>
                  <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                    <th className="px-4 py-2 font-medium">Resource</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">등급</th>
                    <th className="px-4 py-2 font-medium">Credential</th>
                    <th className="px-4 py-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.data.map((resource) => (
                    <tr key={resource.id} className="border-t border-line">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium text-fg">{resource.name}</span>
                        <span className="block font-mono text-xs text-fg-subtle">
                          {resource.adapterType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                        {resource.type}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={CLASSIFICATION_TONE[resource.classification]}>
                          {resource.classification}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {resource.credentialRef ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-fg-muted">
                              {resource.credentialRef}
                            </span>
                            {/* 값은 절대 표시하지 않는다. 설정 여부만 알린다. */}
                            <Badge tone={resource.credentialConfigured ? 'ok' : 'danger'}>
                              {resource.credentialConfigured ? '설정됨' : '환경변수 없음'}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-xs text-fg-subtle">불필요</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={resource.enabled ? 'ok' : 'neutral'}>
                          {resource.enabled ? 'ENABLED' : 'DISABLED'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
