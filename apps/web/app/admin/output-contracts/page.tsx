'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  post,
  type OutputContract,
  type Project,
  type ResolvedOutputContract,
  type Team,
} from '@/lib/api';
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

const SCOPE_TONE = {
  COMPANY: 'locked',
  TEAM: 'accent',
  PROJECT: 'active',
  PERSONAL: 'pending',
} as const;

export default function OutputContractsPage() {
  const orgId = useOrgId();
  const contracts = useResource<OutputContract[]>(
    async () =>
      (await api<{ contracts: OutputContract[] }>(`/organizations/${orgId}/output-contracts`))
        .contracts,
    [orgId],
  );
  const teams = useResource<Team[]>(
    async () => (await api<{ teams: Team[] }>(`/organizations/${orgId}/teams`)).teams,
    [orgId],
  );
  const projects = useResource<Project[]>(
    async () => (await api<{ projects: Project[] }>(`/organizations/${orgId}/projects`)).projects,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [scopeType, setScopeType] = useState('COMPANY');
  const [resolved, setResolved] = useState<ResolvedOutputContract | null>(null);
  const [resolveProject, setResolveProject] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setPending(true);
    try {
      await post(`/organizations/${orgId}/output-contracts`, {
        name: String(data.get('name')),
        description: String(data.get('description') ?? ''),
        scopeType,
        // COMPANY는 조직 자신을 가리키므로 서버가 채운다.
        scopeId: scopeType === 'COMPANY' ? undefined : String(data.get('scopeId')),
        // 쉼표로 여러 항목을 받는다. lowerCamelCase만 통과한다.
        fields: String(data.get('fields'))
          .split(',')
          .map((field) => field.trim())
          .filter(Boolean),
      });
      form.reset();
      contracts.reload();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    } finally {
      setPending(false);
    }
  }

  /** 지금 적용되는 계약을 확인한다. 에이전트가 받는 것과 같은 값이다. */
  async function resolve() {
    setError(null);
    try {
      const result = await post<{ outputContract: ResolvedOutputContract }>(
        `/organizations/${orgId}/output-contracts/resolve`,
        resolveProject ? { projectId: resolveProject } : {},
      );
      setResolved(result.outputContract);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, String(err)));
    }
  }

  const scopeOptions =
    scopeType === 'TEAM'
      ? (teams.data ?? []).map((team) => ({ id: team.id, label: team.name }))
      : scopeType === 'PROJECT'
        ? (projects.data ?? []).map((project) => ({ id: project.id, label: project.name }))
        : [];

  return (
    <>
      <PageHeader
        title="산출물 계약"
        description="작업을 마칠 때 무엇을 남겨야 하는지 정합니다. Company · Team · Project 계약은 합쳐집니다."
      />

      <Card className="mb-5">
        <CardHeader
          title="계약 추가"
          description="하위 스코프는 항목을 더하기만 합니다. 상위가 요구한 것을 빼지는 못합니다."
        />
        <form onSubmit={create} className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="w-56">
              <Field label="이름">
                <Input name="name" required placeholder="백엔드 팀 확장" />
              </Field>
            </div>
            <div className="w-40">
              <Field label="스코프">
                <Select value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
                  <option value="COMPANY">COMPANY</option>
                  <option value="TEAM">TEAM</option>
                  <option value="PROJECT">PROJECT</option>
                </Select>
              </Field>
            </div>
            {scopeType !== 'COMPANY' ? (
              <div className="w-56">
                <Field label={scopeType === 'TEAM' ? '팀' : '프로젝트'}>
                  <Select name="scopeId" required>
                    <option value="">선택하세요</option>
                    {scopeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
          </div>
          <Field label="요구 항목 (쉼표로 구분)">
            <Input name="fields" required placeholder="summary, verification, unresolved" />
          </Field>
          <Field label="설명">
            <Input name="description" placeholder="왜 이 항목들이 필요한지" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? '만드는 중…' : '계약 추가'}
            </Button>
            {/* 이름 규칙을 미리 알려 준다. 400을 받고 나서 알면 늦다. */}
            <span className="text-2xs text-fg-subtle">
              항목 이름은 lowerCamelCase만 됩니다. 대소문자만 다르면 계약이 조용히 갈라집니다
            </span>
          </div>
        </form>
      </Card>

      {error ? (
        <div className="mb-5">
          <ErrorState
            title="요청이 실패했습니다"
            statusCode={error.statusCode || undefined}
            message={error.message}
          />
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="지금 적용되는 계약"
          description="에이전트가 company.output_contract로 받는 것과 같은 값입니다."
        />
        <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
          <div className="w-56">
            <Field label="프로젝트">
              <Select
                value={resolveProject}
                onChange={(event) => setResolveProject(event.target.value)}
              >
                <option value="">프로젝트 없음</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button onClick={resolve}>해석</Button>
        </div>
        {resolved === null ? (
          <EmptyState title="해석을 눌러 확인하세요" />
        ) : resolved.requiredFields.length === 0 ? (
          // 빈 계약과 "모른다"는 다르다. 요구 항목이 없다는 사실을 그대로 말한다.
          <EmptyState title="요구 항목이 없습니다" hint="이 범위에 적용되는 계약이 없습니다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs tracking-wide text-fg-subtle uppercase">
                  <th className="px-4 py-2 font-medium">항목</th>
                  <th className="px-4 py-2 font-medium">요구한 곳</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resolved.requiredFields.map((field) => {
                  const source = resolved.sourceMap[field];
                  return (
                    <tr key={field}>
                      <td className="px-4 py-2 font-mono text-xs">{field}</td>
                      <td className="px-4 py-2">
                        {source ? (
                          <span className="flex items-center gap-2">
                            <Badge tone={SCOPE_TONE[source.scope]}>{source.scope}</Badge>
                            <span className="text-xs text-fg-muted">{source.sourceName}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-fg-subtle">—</span>
                        )}
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
          title="등록된 계약"
          description={contracts.data ? `${contracts.data.length}개` : undefined}
        />
        {contracts.loading ? (
          <LoadingState />
        ) : contracts.error ? (
          <ErrorState
            title="계약을 불러오지 못했습니다"
            statusCode={contracts.error.statusCode || undefined}
            message={contracts.error.message}
            onRetry={contracts.reload}
          />
        ) : (contracts.data ?? []).length === 0 ? (
          <EmptyState title="등록된 계약이 없습니다" hint="계약이 없으면 요구 항목도 없습니다" />
        ) : (
          <ul className="divide-y divide-border">
            {(contracts.data ?? []).map((contract) => (
              <li key={contract.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SCOPE_TONE[contract.scopeType]}>{contract.scopeType}</Badge>
                  <span className="font-medium text-fg">{contract.name}</span>
                  {contract.description ? (
                    <span className="text-xs text-fg-muted">{contract.description}</span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {contract.fields.map((field) => (
                    <span
                      key={field}
                      className="rounded-sm border border-border bg-bg-raised px-2 py-0.5 font-mono text-2xs text-fg-muted"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
