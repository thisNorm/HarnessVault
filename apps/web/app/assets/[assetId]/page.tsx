'use client';

import { use } from 'react';
import Link from 'next/link';
import { api, type AssetDetail } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { useOrgId } from '@/components/session';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

export default function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params);
  const orgId = useOrgId();

  const detail = useResource<AssetDetail>(
    () => api<AssetDetail>(`/organizations/${orgId}/assets/${assetId}`),
    [orgId, assetId],
  );

  if (detail.loading) return <LoadingState label="자산 불러오는 중" />;
  if (detail.error) {
    return (
      <ErrorState
        title="자산을 불러오지 못했습니다"
        statusCode={detail.error.statusCode || undefined}
        message={detail.error.message}
        onRetry={detail.reload}
      />
    );
  }
  if (!detail.data) return <EmptyState title="자산이 없습니다" />;

  const { asset, versions, relations, activeVersionCount } = detail.data;
  const selectorEntries = Object.entries(asset.selector ?? {}).filter(
    ([, value]) => Array.isArray(value) && value.length > 0,
  );

  return (
    <>
      <Link href="/assets" className="mb-3 inline-block text-xs text-fg-muted hover:text-fg">
        ← 자산 목록
      </Link>
      <PageHeader title={asset.name} description={asset.key} />

      {/* 충돌을 감추지 않는다. Resolver가 RESOLUTION_CONFLICT로 거부하게 되는 상태다. */}
      {activeVersionCount > 1 ? (
        <div className="mb-4 rounded-md border border-state-deny/30 bg-state-deny/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge tone="deny">RESOLUTION_CONFLICT</Badge>
            <span className="text-sm font-medium text-fg">
              ACTIVE 버전이 {activeVersionCount}개입니다
            </span>
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            Resolver는 이 자산을 자동으로 고르지 않고 충돌로 보고합니다. 한 버전만 남기세요.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="버전" description={`${versions.length}개 · 버전은 삭제되지 않습니다`} />
            {versions.length === 0 ? (
              <EmptyState title="버전이 없습니다" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                      <th className="px-4 py-2 font-medium">버전</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">요약</th>
                      <th className="px-4 py-2 font-medium">추정 토큰</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => (
                      <tr key={version.id} className="border-t border-border">
                        <td className="px-4 py-2.5 font-mono text-xs text-fg">{version.version}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={version.status} />
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">{version.summary || '—'}</td>
                        <td
                          className="px-4 py-2.5 font-mono text-xs text-fg-subtle"
                          title="실측이 아닌 추정치입니다"
                        >
                          {version.estimatedTokens === null ? '—' : `~${version.estimatedTokens}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="관계" description="Resolver가 의존성·Variant를 확장할 때 씁니다" />
            {relations.outgoing.length === 0 && relations.incoming.length === 0 ? (
              <EmptyState title="연결된 자산이 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {relations.outgoing.map((relation) => (
                  <RelationRow key={relation.id} relation={relation} direction="→" />
                ))}
                {relations.incoming.map((relation) => (
                  <RelationRow key={relation.id} relation={relation} direction="←" />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="메타데이터" />
          <dl className="divide-y divide-border text-sm">
            <Row label="Type">
              <Badge tone="accent">{asset.type}</Badge>
            </Row>
            <Row label="Status">
              <StatusBadge status={asset.status} />
            </Row>
            <Row label="Scope">
              <span className="font-mono text-xs">{asset.scopeType}</span>
            </Row>
            <Row label="Inheritance">
              <Badge tone={asset.inheritanceMode === 'LOCKED' ? 'locked' : 'accent'}>
                {asset.inheritanceMode}
              </Badge>
            </Row>
            <Row label="Owner">
              <span className="font-mono text-xs">{asset.ownerType}</span>
            </Row>
            <Row label="Asset ID">
              <span className="font-mono text-xs break-all text-fg-subtle">{asset.id}</span>
            </Row>
            <Row label="Selector">
              {selectorEntries.length === 0 ? (
                <span className="text-xs text-fg-subtle">조건 없음</span>
              ) : (
                <div className="flex flex-wrap justify-end gap-1">
                  {selectorEntries.map(([key, values]) => (
                    <span
                      key={key}
                      className="rounded-xs border border-border bg-bg-raised px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
                    >
                      {key}: {(values as string[]).join(', ')}
                    </span>
                  ))}
                </div>
              )}
            </Row>
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

function RelationRow({
  relation,
  direction,
}: {
  relation: AssetDetail['relations']['outgoing'][number];
  direction: '→' | '←';
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-4 shrink-0 text-center text-fg-subtle">{direction}</span>
      <Badge tone="accent">{relation.type}</Badge>
      <Link href={`/assets/${relation.assetId}`} className="min-w-0 hover:underline">
        <span className="block truncate text-sm text-fg">{relation.name}</span>
        <span className="block truncate font-mono text-xs text-fg-subtle">{relation.key}</span>
      </Link>
    </li>
  );
}
