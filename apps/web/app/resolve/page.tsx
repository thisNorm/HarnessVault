'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ApiError,
  api,
  post,
  type CompileTarget,
  type CompiledHarness,
  type Project,
  type ResolvedManifest,
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
  PageHeader,
  Select,
} from '@/components/ui';

interface Conflict {
  kind: string;
  key: string;
  detail: string;
}

export default function ResolvePage() {
  const orgId = useOrgId();
  const projects = useResource<Project[]>(
    async () => (await api<{ projects: Project[] }>(`/organizations/${orgId}/projects`)).projects,
    [orgId],
  );

  const [manifest, setManifest] = useState<ResolvedManifest | null>(null);
  const [compiled, setCompiled] = useState<CompiledHarness | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<CompileTarget>('CODEX');
  const [view, setView] = useState<'manifest' | 'files'>('manifest');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const list = (name: string) =>
      String(form.get(name) ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const text = (name: string) => String(form.get(name) ?? '').trim() || null;
    const budget = String(form.get('contextBudget') ?? '').trim();

    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      // 해석과 컴파일을 한 번에 받는다. 콘솔은 에이전트를 실행하지 않는다 — 파일만 미리 보여준다.
      const result = await post<{ manifest: ResolvedManifest; compiled: CompiledHarness }>(
        `/organizations/${orgId}/compile`,
        {
          target,
          projectId: text('projectId'),
          task: {
            description: String(form.get('description') ?? ''),
            domain: list('domain'),
            type: list('type'),
          },
          environment: {
            os: text('os'),
            runtime: text('runtime'),
            database: text('database'),
            environment: text('environment'),
          },
          contextBudget: budget ? Number(budget) : null,
        },
      );
      setManifest(result.manifest);
      setCompiled(result.compiled);
    } catch (err: unknown) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, String(err));
      setManifest(null);
      setCompiled(null);
      // 충돌은 실패다. 임의로 한 버전을 고르지 않았다는 사실을 그대로 보여준다.
      if (apiError.statusCode === 409 && Array.isArray(apiError.details?.conflicts)) {
        setConflicts(apiError.details.conflicts as Conflict[]);
      } else {
        setError(apiError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Resolve Explainer"
        description="현재 컨텍스트에서 어떤 Harness가 적용되는지, 그리고 무엇이 왜 빠졌는지 확인합니다."
      />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="컨텍스트" description="Agent가 보내는 것과 같은 입력입니다" />
          <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
            <Field label="작업 설명">
              <Input name="description" required defaultValue="DB 장애 분석" />
            </Field>
            <Field label="Project">
              <Select name="projectId" defaultValue="">
                <option value="">Project 없음</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Domain">
                <Input name="domain" placeholder="database" defaultValue="database" />
              </Field>
              <Field label="Task type">
                <Input name="type" placeholder="troubleshoot" defaultValue="troubleshoot" />
              </Field>
              <Field label="OS">
                <Input name="os" placeholder="linux" />
              </Field>
              <Field label="Runtime">
                <Input name="runtime" placeholder="node" />
              </Field>
              <Field label="Database">
                <Input name="database" placeholder="sqlite" defaultValue="sqlite" />
              </Field>
              <Field label="Environment">
                <Input name="environment" placeholder="production" />
              </Field>
            </div>
            <Field label="Context budget (추정 토큰)">
              <Input name="contextBudget" type="number" min={1} placeholder="비우면 제한 없음" />
            </Field>
            <Field label="컴파일 타깃">
              <Select value={target} onChange={(e) => setTarget(e.target.value as CompileTarget)}>
                <option value="CODEX">Codex (AGENTS.md)</option>
                <option value="CLAUDE_CODE">Claude Code (CLAUDE.md)</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary" disabled={pending} className="mt-1">
              {pending ? '해석 중…' : 'Resolve'}
            </Button>
            <p className="text-2xs text-fg-subtle">
              쉼표로 여러 값을 넣을 수 있습니다. 이 결정에는 LLM이 관여하지 않습니다.
            </p>
          </form>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {conflicts ? <ConflictCard conflicts={conflicts} /> : null}
          {error ? (
            <ErrorState
              title="해석에 실패했습니다"
              statusCode={error.statusCode || undefined}
              message={error.message}
            />
          ) : null}
          {!manifest && !conflicts && !error ? (
            <Card>
              <EmptyState
                title="아직 해석하지 않았습니다"
                hint="왼쪽 컨텍스트로 Resolve를 실행하세요."
              />
            </Card>
          ) : null}
          {manifest ? (
            <>
              <div className="flex gap-1.5">
                <TabButton active={view === 'manifest'} onClick={() => setView('manifest')}>
                  Manifest
                </TabButton>
                <TabButton active={view === 'files'} onClick={() => setView('files')}>
                  생성 파일 {compiled ? `(${compiled.files.length})` : ''}
                </TabButton>
              </div>
              {view === 'manifest' ? (
                <ManifestView manifest={manifest} />
              ) : compiled ? (
                <CompiledView compiled={compiled} />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'border-accent/40 bg-accent-soft text-fg'
          : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

/** 초안 UI의 `Agent에 적용 (Dry Run)`을 대신한다. 콘솔은 에이전트를 실행하지 않는다(§59). */
function CompiledView({ compiled }: { compiled: CompiledHarness }) {
  return (
    <Card>
      <CardHeader
        title={`${compiled.metadata.target} 타깃 파일`}
        description="이 파일들이 에이전트 작업 디렉터리에 놓입니다. 콘솔은 실행하지 않습니다."
      />
      <ul className="divide-y divide-border">
        {compiled.files.map((file) => (
          <li key={file.path}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover">
                <span className="min-w-0 truncate font-mono text-sm text-fg">{file.path}</span>
                <span className="shrink-0 font-mono text-2xs text-fg-subtle">
                  {file.content.length}자
                </span>
              </summary>
              <pre className="overflow-x-auto border-t border-border bg-bg-raised px-4 py-3 font-mono text-xs whitespace-pre text-fg-muted">
                {file.content}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ConflictCard({ conflicts }: { conflicts: Conflict[] }) {
  return (
    <Card className="border-state-deny/40">
      <CardHeader
        title="RESOLUTION_CONFLICT"
        description="충돌이 있어 자동으로 선택하지 않았습니다. 어느 것을 쓸지는 사람이 정해야 합니다."
      />
      <ul className="divide-y divide-border">
        {conflicts.map((conflict, index) => (
          <li key={`${conflict.key}-${index}`} className="flex items-start gap-3 px-4 py-3">
            <Badge tone="deny">{conflict.kind}</Badge>
            <div className="min-w-0">
              <p className="font-mono text-sm text-fg">{conflict.key}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{conflict.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const GROUPS = [
  ['rules', 'Rules'],
  ['policies', 'Policies'],
  ['validations', 'Validations'],
  ['workflows', 'Workflows'],
  ['skills', 'Skills'],
  ['variants', 'Variants'],
  ['scripts', 'Scripts'],
  ['templates', 'Templates'],
  ['knowledge', 'Knowledge'],
] as const;

function ManifestView({ manifest }: { manifest: ResolvedManifest }) {
  const { resolution } = manifest;
  const reduction =
    resolution.candidateCount > 0
      ? Math.round((1 - resolution.selectedCount / resolution.candidateCount) * 1000) / 10
      : 0;

  const selected = GROUPS.flatMap(([key, label]) =>
    manifest[key].map((ref) => ({ ...ref, group: label })),
  );

  return (
    <>
      <Card>
        <CardHeader title="Resolution" description={`trace ${manifest.traceId}`} />
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Stat label="후보" value={String(resolution.candidateCount)} />
          <Stat label="선택" value={String(resolution.selectedCount)} />
          <Stat label="제외" value={String(resolution.excludedCount)} />
          <Stat label="감축" value={`${reduction}%`} />
          <Stat
            label="주입 추정"
            value={`~${resolution.estimatedInjectedTokens}`}
            hint="실측이 아닌 추정치입니다"
          />
          <Stat
            label="예산"
            value={
              resolution.estimatedAvailableTokens === null
                ? '제한 없음'
                : `${resolution.estimatedAvailableTokens}`
            }
          />
          <Stat label="Output Contract" value="Phase 10" hint="아직 결정 로직이 없습니다" />
          <Stat
            label="예산 초과"
            value={resolution.budgetExceededByMandatory ? '필수 자산으로 초과' : '없음'}
            tone={resolution.budgetExceededByMandatory ? 'deny' : undefined}
          />
        </dl>
      </Card>

      <Card>
        <CardHeader title="선택된 자산" description={`${selected.length}개 · 주입 순서대로`} />
        {selected.length === 0 ? (
          <EmptyState title="선택된 자산이 없습니다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">자산</th>
                  <th className="px-4 py-2 font-medium">Scope</th>
                  <th className="px-4 py-2 font-medium">Ver</th>
                  <th className="px-4 py-2 font-medium">~토큰</th>
                  <th className="px-4 py-2 font-medium">선택 이유</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((ref, index) => (
                  <tr key={ref.assetId} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/assets/${ref.assetId}`} className="hover:underline">
                        <span className="block font-medium text-fg">{ref.name}</span>
                        <span className="block font-mono text-xs text-fg-subtle">{ref.key}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="accent">{ref.type}</Badge>
                        <span className="font-mono text-xs text-fg-muted">{ref.scope}</span>
                        {ref.mandatory ? <Badge tone="locked">필수</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{ref.version}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">
                      ~{ref.estimatedTokens}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block text-xs text-fg-muted">{ref.reason}</span>
                      <span className="mt-0.5 block font-mono text-2xs text-fg-subtle">
                        {ref.reasonCode}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="제외된 자산"
          description={`${manifest.excluded.length}개 · 왜 빠졌는지 전부 남깁니다`}
        />
        {manifest.excluded.length === 0 ? (
          <EmptyState title="제외된 자산이 없습니다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-sm">
              <thead>
                <tr className="text-left text-2xs tracking-wider text-fg-subtle uppercase">
                  <th className="px-4 py-2 font-medium">자산</th>
                  <th className="px-4 py-2 font-medium">Scope</th>
                  <th className="px-4 py-2 font-medium">제외 이유</th>
                </tr>
              </thead>
              <tbody>
                {manifest.excluded.map((ref) => (
                  <tr key={`${ref.assetId}-${ref.reasonCode}`} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <Link href={`/assets/${ref.assetId}`} className="hover:underline">
                        <span className="block text-fg-muted">{ref.name}</span>
                        <span className="block font-mono text-xs text-fg-subtle">{ref.key}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="locked">{ref.type}</Badge>
                        <span className="font-mono text-xs text-fg-subtle">{ref.scope}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block text-xs text-fg-muted">{ref.reason}</span>
                      <span className="mt-0.5 block font-mono text-2xs text-fg-subtle">
                        {ref.reasonCode}
                      </span>
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

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'deny';
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd
        className={`mt-1 font-mono text-sm ${tone === 'deny' ? 'text-state-deny' : 'text-fg'}`}
        title={hint}
      >
        {value}
      </dd>
    </div>
  );
}
