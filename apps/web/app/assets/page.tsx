'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type Asset, type Capability } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  SCOPE_TYPES,
  Select,
  StatusBadge,
} from '@/components/ui';

export default function AssetsPage() {
  const orgId = useOrgId();
  const [type, setType] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const query = new URLSearchParams();
  if (type) query.set('type', type);
  if (scopeType) query.set('scopeType', scopeType);
  if (status) query.set('status', status);
  if (q.trim()) query.set('q', q.trim());
  const search = query.toString();

  const assets = useResource<Asset[]>(
    async () =>
      (await api<{ assets: Asset[] }>(`/organizations/${orgId}/assets${search ? `?${search}` : ''}`))
        .assets,
    [orgId, search],
  );

  const capabilities = useResource<Capability[]>(
    async () =>
      (await api<{ capabilities: Capability[] }>(`/organizations/${orgId}/capabilities`))
        .capabilities,
    [orgId],
  );

  const capabilityName = new Map((capabilities.data ?? []).map((c) => [c.id, c.key]));

  return (
    <>
      <PageHeader
        title="자산"
        description="조직이 소유한 Harness 자산입니다. 타입은 필드이므로 목록에서 걸러 봅니다."
      />

      <Card>
        <CardHeader
          title="Harness Assets"
          count={assets.data?.length}
        />

        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <div className="w-44">
            <FilterField label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">전체</option>
                {ASSET_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FilterField>
          </div>
          <div className="w-36">
            <FilterField label="Scope">
              <Select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
                <option value="">전체</option>
                {SCOPE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FilterField>
          </div>
          <div className="w-36">
            <FilterField label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">전체</option>
                {ASSET_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FilterField>
          </div>
          <div className="min-w-52 flex-1">
            <FilterField label="검색">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="key · 이름 · 설명"
              />
            </FilterField>
          </div>
        </div>

        {assets.loading ? (
          <LoadingState />
        ) : assets.error ? (
          <ErrorState
            title="자산 목록을 불러오지 못했습니다"
            statusCode={assets.error.statusCode || undefined}
            message={assets.error.message}
            onRetry={assets.reload}
          />
        ) : !assets.data || assets.data.length === 0 ? (
          <EmptyState
            title="조건에 맞는 자산이 없습니다"
            hint={search ? '필터를 지우면 전체를 볼 수 있습니다.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                  <th className="px-4 py-2 font-medium">자산</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Scope</th>
                  <th className="px-4 py-2 font-medium">Inheritance</th>
                  <th className="px-4 py-2 font-medium">Capability</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.map((asset) => (
                  <tr key={asset.id} className="border-t border-line hover:bg-surface-3">
                    <td className="px-4 py-2.5">
                      <Link href={`/assets/${asset.id}`} className="block">
                        <span className="block font-medium text-fg">{asset.name}</span>
                        <span className="block font-mono text-xs text-fg-subtle">{asset.key}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone="accent">{asset.type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                      {asset.scopeType}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={asset.inheritanceMode === 'LOCKED' ? 'neutral' : 'accent'}>
                        {asset.inheritanceMode}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">
                      {asset.capabilityId ? (capabilityName.get(asset.capabilityId) ?? '—') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={asset.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</span>
      {children}
    </label>
  );
}
