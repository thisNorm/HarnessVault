'use client';

import { useState, type FormEvent } from 'react';
import { ApiError, api, post, type Policy, type ResourceSummary } from '@/lib/api';
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

const EFFECTS = ['ALLOW', 'APPROVAL_REQUIRED', 'DENY'] as const;
const ACTIONS = [
  '*',
  'files.search',
  'files.read',
  'files.write',
  'db.schema',
  'db.query',
  'db.update',
  'git.status',
  'git.read',
  'git.write',
] as const;

const EFFECT_TONE = {
  ALLOW: 'active',
  APPROVAL_REQUIRED: 'pending',
  DENY: 'deny',
} as const;

export default function PoliciesPage() {
  const orgId = useOrgId();
  const policies = useResource<Policy[]>(
    async () => (await api<{ policies: Policy[] }>(`/organizations/${orgId}/policies`)).policies,
    [orgId],
  );
  const resources = useResource<ResourceSummary[]>(
    async () =>
      (await api<{ resources: ResourceSummary[] }>(`/organizations/${orgId}/resources`)).resources,
    [orgId],
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setPending(true);
    try {
      await post(`/organizations/${orgId}/policies`, {
        name: String(data.get('name')),
        effect: String(data.get('effect')),
        scopeType: 'COMPANY',
        inheritanceMode: String(data.get('inheritanceMode')),
        actions: [String(data.get('action'))],
        resourceId: String(data.get('resourceId')) || null,
      });
      policies.reload();
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
        title="Policies"
        description="모든 Resource Action은 ALLOW · APPROVAL_REQUIRED · DENY 중 하나로 결정됩니다. 매칭되는 정책이 없으면 거부됩니다."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="정책 추가"
            description="회사 스코프 정책만 여기서 만듭니다. 팀·프로젝트 정책은 API로 만듭니다."
          />
          <form onSubmit={create} className="flex flex-wrap items-end gap-2.5 px-4 py-3">
            <div className="min-w-44 flex-1">
              <Field label="이름">
                <Input name="name" required placeholder="RESTRICTED 조회 금지" />
              </Field>
            </div>
            <div className="w-44">
              <Field label="Effect">
                <Select name="effect" defaultValue="DENY">
                  {EFFECTS.map((effect) => (
                    <option key={effect} value={effect}>
                      {effect}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Action">
                <Select name="action" defaultValue="*">
                  {ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-44">
              <Field label="Resource (선택)">
                <Select name="resourceId" defaultValue="">
                  <option value="">모든 Resource</option>
                  {(resources.data ?? []).map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="상속">
                <Select name="inheritanceMode" defaultValue="DEFAULT">
                  <option value="DEFAULT">DEFAULT</option>
                  <option value="OVERRIDABLE">OVERRIDABLE</option>
                  <option value="LOCKED">LOCKED (하위가 못 바꿈)</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? '추가 중…' : '정책 추가'}
            </Button>
          </form>
          {error ? (
            <ErrorState
              title="정책을 만들지 못했습니다"
              statusCode={error.statusCode || undefined}
              message={error.message}
            />
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="정책 목록"
            description={policies.data ? `${policies.data.length}개` : undefined}
          />
          {policies.loading ? (
            <LoadingState />
          ) : policies.error ? (
            <ErrorState
              title="정책을 불러오지 못했습니다"
              statusCode={policies.error.statusCode || undefined}
              message={policies.error.message}
              onRetry={policies.reload}
            />
          ) : !policies.data || policies.data.length === 0 ? (
            <EmptyState
              title="정책이 없습니다"
              hint="정책이 하나도 없으면 모든 Resource Action이 거부됩니다."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl text-sm">
                <thead>
                  <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                    <th className="px-4 py-2 font-medium">정책</th>
                    <th className="px-4 py-2 font-medium">Effect</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                    <th className="px-4 py-2 font-medium">상속</th>
                    <th className="px-4 py-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.data.map((policy) => (
                    <tr key={policy.id} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium text-fg">{policy.name}</span>
                        {policy.description ? (
                          <span className="block text-xs text-fg-subtle">{policy.description}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={EFFECT_TONE[policy.effect]}>{policy.effect}</Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                        {policy.scopeType}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                        {policy.actions.join(', ')}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={policy.inheritanceMode === 'LOCKED' ? 'locked' : 'accent'}>
                          {policy.inheritanceMode}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={policy.enabled ? 'active' : 'locked'}>
                          {policy.enabled ? 'ENABLED' : 'DISABLED'}
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
