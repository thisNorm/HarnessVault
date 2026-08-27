'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type AnalyticsBundle, type AverageWithSampleSize, type CountBucket } from '@/lib/api';
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
  Select,
} from '@/components/ui';

const RANGES = [
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
  { value: '90', label: '최근 90일' },
  { value: '0', label: '전 구간' },
];

export default function AnalyticsPage() {
  const orgId = useOrgId();
  const [days, setDays] = useState('30');
  const analytics = useResource<AnalyticsBundle>(
    async () =>
      (await api<{ analytics: AnalyticsBundle }>(`/organizations/${orgId}/analytics?days=${days}`))
        .analytics,
    [orgId, days],
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        description="무엇이 실제로 쓰이는지 봅니다. 개인별 생산성 점수는 만들지 않습니다."
      />

      <div className="mb-4 flex items-center gap-2">
        <Select value={days} onChange={(event) => setDays(event.target.value)}>
          {RANGES.map((range) => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </Select>
      </div>

      {analytics.loading ? (
        <LoadingState label="집계 불러오는 중" />
      ) : analytics.error ? (
        <ErrorState
          title="집계를 불러오지 못했습니다"
          statusCode={analytics.error.statusCode || undefined}
          message={analytics.error.message}
          onRetry={analytics.reload}
        />
      ) : analytics.data ? (
        <Bundle data={analytics.data} />
      ) : null}
    </>
  );
}

function Bundle({ data }: { data: AnalyticsBundle }) {
  return (
    <div className="flex flex-col gap-4">
      {/* 같은 카드 3장을 나란히 두지 않는다. 판 하나에 구분선으로 나눈다. */}
      <Card>
        <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Metric label="자산" value={data.overview.totalAssets} />
          <Metric label="흐름" value={data.overview.totalTraces} />
          <Metric label="기여" value={data.overview.totalContributions} />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="타입별" />
          <Buckets items={data.overview.assetsByType} />
        </Card>
        <Card>
          <CardHeader title="스코프별" />
          <Buckets items={data.overview.assetsByScope} />
        </Card>
        <Card>
          <CardHeader title="상태별" />
          <Buckets items={data.overview.assetsByStatus} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="자산 사용량"
          description="후보에 오른 횟수 대비 실제 주입된 횟수입니다"
        />
        {data.assetUsage.length === 0 ? (
          <EmptyState title="아직 해석 기록이 없습니다" hint="/resolve에서 한 번 실행해 보세요" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-2xs tracking-wide text-fg-subtle uppercase">
                  <th className="px-4 py-2 font-medium">자산</th>
                  <th className="px-4 py-2 font-medium">주입</th>
                  <th className="px-4 py-2 font-medium">제외</th>
                  <th className="px-4 py-2 font-medium">선택률</th>
                  <th className="px-4 py-2 font-medium">주 제외 사유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.assetUsage.map((row) => (
                  <tr key={row.assetId}>
                    <td className="px-4 py-2">
                      <Link href={`/assets/${row.assetId}`} className="hover:text-accent">
                        {row.name}
                      </Link>
                      <span className="ml-2 font-mono text-2xs text-fg-subtle">{row.key}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{row.selectedCount}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.excludedCount}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {/* 분모가 0이면 비율을 만들지 않는다. */}
                      {row.selectionRate === null
                        ? '—'
                        : `${Math.round(row.selectionRate * 100)}%`}
                    </td>
                    <td className="px-4 py-2 font-mono text-2xs text-fg-subtle">
                      {row.topExclusionReason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="한 번도 주입되지 않은 자산"
            description="후보에는 올랐어도 매번 밀린 것을 포함합니다"
          />
          {data.unusedAssets.length === 0 ? (
            <EmptyState title="모든 ACTIVE 자산이 한 번 이상 쓰였습니다" />
          ) : (
            <ul className="divide-y divide-line">
              {data.unusedAssets.map((asset) => (
                <li key={asset.assetId} className="flex items-center gap-2 px-4 py-2">
                  <Badge tone="neutral">{asset.type}</Badge>
                  <Link
                    href={`/assets/${asset.assetId}`}
                    className="min-w-0 flex-1 truncate text-sm hover:text-accent"
                  >
                    {asset.name}
                  </Link>
                  <span className="font-mono text-2xs text-fg-subtle">{asset.key}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Capability" description="자산이 어디에 몰려 있는지" />
          <Buckets items={data.capabilities} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Context 효율"
          description="전부 추정치입니다. 갈래마다 신뢰도가 달라 한 숫자로 합치지 않습니다"
        />
        <dl className="divide-y divide-line text-sm">
          <AverageRow label="후보 평균" average={data.contextEfficiency.averageCandidates} />
          <AverageRow label="선택 평균" average={data.contextEfficiency.averageSelected} />
          <AverageRow
            label="감축률 평균"
            average={data.contextEfficiency.averageReductionPercent}
            suffix="%"
          />
          <AverageRow
            label="주입 토큰 (추정)"
            average={data.contextEfficiency.averageInjectedTokens}
            prefix="~"
          />
          <AverageRow
            label="Client 보고 입력 토큰"
            average={data.contextEfficiency.averageClientReportedInputTokens}
            hint="클라이언트 자가 보고. 보고하지 않은 흐름은 평균에서 제외했습니다"
          />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="산출물 계약"
            description={`종료된 흐름 ${data.outputContract.completedTraces}건`}
          />
          <dl className="divide-y divide-line text-sm">
            <Row label="충족률">
              <span className="font-mono text-xs">
                {data.outputContract.satisfiedRate === null
                  ? '—'
                  : `${Math.round(data.outputContract.satisfiedRate * 100)}%`}
              </span>
            </Row>
          </dl>
          {data.outputContract.mostMissedFields.length > 0 ? (
            <>
              <div className="px-4 pt-2 text-2xs tracking-wide text-fg-subtle uppercase">
                가장 많이 빠진 항목
              </div>
              <Buckets items={data.outputContract.mostMissedFields} />
            </>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="승인" />
          <Buckets items={data.approvals.byStatus} />
          <dl className="divide-y divide-line border-t border-line text-sm">
            <AverageRow
              label="판단까지 평균"
              average={data.approvals.averageDecisionSeconds}
              suffix="초"
              hint="아직 판단되지 않은 요청은 평균에서 제외했습니다"
            />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Contribution"
            description={`중복 표시 ${data.contributions.duplicateFlaggedCount}건`}
          />
          <Buckets items={data.contributions.byStatus} />
          <dl className="divide-y divide-line border-t border-line text-sm">
            <Row label="승격률">
              <span className="font-mono text-xs">
                {data.contributions.promotedRate === null
                  ? '—'
                  : `${Math.round(data.contributions.promotedRate * 100)}%`}
              </span>
            </Row>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Curator"
            description={`총 ${data.curator.totalRuns}회 · 실패 ${data.curator.failedCount}회`}
          />
          <Buckets items={data.curator.byVerdict} />
          <div className="border-t border-line px-4 pt-2 text-2xs tracking-wide text-fg-subtle uppercase">
            무엇이 판단했는가
          </div>
          {/* MOCK 비율을 숨기지 않는다. 실제 모델이 얼마나 돌았는지가 보여야 한다. */}
          <Buckets items={data.curator.byProvider} />
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3.5">
      <dt className="text-2xs font-medium tracking-[0.04em] text-fg-subtle uppercase">{label}</dt>
      <dd className="tabular mt-1.5 font-mono text-metric font-medium text-fg">{value}</dd>
    </div>
  );
}

function Buckets({ items }: { items: CountBucket[] }) {
  if (items.length === 0) return <EmptyState title="집계할 것이 없습니다" />;
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <ul className="flex flex-col gap-1.5 px-4 py-3">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-xs text-fg-muted" title={item.label}>
            {item.label}
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </span>
          <span className="tabular w-8 shrink-0 text-right font-mono text-xs text-fg-muted">
            {item.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2">
      <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** 평균에 몇 건이 들어갔는지 늘 함께 보여준다. 모르는 값을 0으로 세지 않았다는 증거다(§40). */
function AverageRow({
  label,
  average,
  prefix = '',
  suffix = '',
  hint,
}: {
  label: string;
  average: AverageWithSampleSize;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  const incomplete = average.sampleSize < average.totalCandidates;
  return (
    <Row label={label}>
      <span className="flex items-baseline justify-end gap-2">
        <span className="tabular font-mono text-xs text-fg">
          {average.value === null ? '—' : `${prefix}${average.value}${suffix}`}
        </span>
        {/* 표본 수를 늘 함께 둔다. 모르는 값을 0으로 세지 않았다는 증거다. */}
        <span
          className={`shrink-0 text-2xs ${incomplete ? 'text-warn' : 'text-fg-subtle'}`}
          title={hint}
        >
          {average.totalCandidates === 0
            ? '대상 없음'
            : incomplete
              ? `${average.sampleSize}/${average.totalCandidates}건`
              : `${average.sampleSize}건`}
        </span>
      </span>
    </Row>
  );
}
