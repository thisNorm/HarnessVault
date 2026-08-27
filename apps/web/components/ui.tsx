import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

import { assetStatuses, harnessAssetTypes, scopeTypes } from '@harnessvault/domain';

// 필터 옵션은 도메인 패키지를 단일 출처로 쓴다. 여기서 다시 나열하면 계약이 갈라진다.
export const ASSET_TYPES = harnessAssetTypes;
export const ASSET_STATUSES = assetStatuses;
export const SCOPE_TYPES = scopeTypes;

/**
 * 톤은 **의미**다. 색을 고르는 게 아니라 뜻을 고른다(DESIGN.md §2).
 * accent(파랑)는 "누를 수 있다"만 뜻하므로 상태 표시에 쓰지 않는다.
 */
export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const TONE: Record<Tone, string> = {
  ok: 'text-ok bg-ok-dim',
  warn: 'text-warn bg-warn-dim',
  danger: 'text-danger bg-danger-dim',
  neutral: 'text-neutral bg-neutral-dim',
  accent: 'text-accent bg-accent-dim',
};

const RAIL: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-neutral',
  accent: 'bg-accent',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 font-mono text-2xs font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * 시그니처 — 목록 행 왼쪽의 2px 상태 막대.
 * 배지를 줄마다 반복하는 것보다 훑을 때 빠르고 화면이 조용하다.
 */
export function StatusRail({ tone }: { tone: Tone }) {
  return <span className={`absolute inset-y-0 left-0 w-0.5 ${RAIL[tone]}`} aria-hidden />;
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'ok',
  APPROVED: 'ok',
  EXECUTED: 'ok',
  PROMOTED: 'ok',
  SUCCEEDED: 'ok',
  COMPLETED: 'ok',
  PENDING: 'warn',
  CANDIDATE: 'warn',
  EXECUTING: 'warn',
  OPEN: 'warn',
  DRAFT: 'neutral',
  LOCKED: 'neutral',
  SUPERSEDED: 'neutral',
  ARCHIVED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  WITHDRAWN: 'neutral',
  DEPRECATED: 'danger',
  DENY: 'danger',
  REJECTED: 'danger',
  FAILED: 'danger',
};

export function toneOf(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

/** 도메인 상태값은 번역하지 않고 그대로 노출한다. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneOf(status)}>{status}</Badge>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

const BUTTON: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-press',
  secondary: 'bg-surface-2 text-fg ring-1 ring-line-strong ring-inset hover:bg-surface-3',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-transparent text-danger ring-1 ring-danger/30 ring-inset hover:bg-danger-dim',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      // 눌림은 0.5px만 내린다. 도구에서 과한 모션은 느리게 느껴진다(DESIGN.md §6).
      className={`inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-[background-color,color] duration-[120ms] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ${BUTTON[variant]} ${className}`}
    />
  );
}

const FIELD =
  'h-[30px] w-full rounded-md bg-surface-2 px-2.5 text-sm text-fg ring-1 ring-line-strong ring-inset transition-[box-shadow,background-color] duration-[120ms] placeholder:text-fg-subtle focus:ring-accent focus:outline-none disabled:opacity-50';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${className}`} />;
}

/**
 * 네이티브 화살표를 지우고 직접 그린다.
 * 그대로 두면 시스템 크롬(밝은 배경·OS 화살표)이 다크 테마를 깬다 — 가장 큰 시각 결함이었다.
 */
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex w-full items-center ${className}`}>
      <select {...props} className={`${FIELD} cursor-pointer pr-7`} />
      <svg
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-2.5 size-3 text-fg-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-2xs font-medium tracking-[0.04em] text-fg-subtle uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  // 깊이는 그림자가 아니라 표면 밝기다(DESIGN.md §7).
  return (
    <section className={`overflow-hidden rounded-lg bg-surface ring-1 ring-line ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  count,
  description,
  action,
}: {
  title: string;
  /** 개수는 제목 옆에 붙인다. 설명 자리에 넣으면 성격이 다른 둘이 섞인다. */
  count?: number | string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
          <span className="truncate">{title}</span>
          {count === undefined ? null : (
            <span className="tabular shrink-0 font-mono text-xs font-normal text-fg-subtle">
              {count}
            </span>
          )}
        </h2>
        {description ? <p className="mt-0.5 truncate text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/* ---- 로딩 / 빈 / 에러 3상태 ---- */

export function LoadingState({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-10 text-sm text-fg-muted">
      {/* 스피너를 돌리지 않는다. 세 점만으로 충분하고 시선을 뺏지 않는다. */}
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1 animate-pulse rounded-full bg-fg-subtle"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  // 아이콘을 넣지 않는다. 왜 비었는지와 다음 행동만 쓴다(DESIGN.md Do/Don't).
  return (
    <div className="px-4 py-10">
      <p className="text-sm text-fg-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({
  title,
  statusCode,
  message,
  onRetry,
}: {
  title: string;
  statusCode?: number;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="m-4 rounded-md bg-danger-dim px-4 py-3.5 ring-1 ring-danger/25 ring-inset">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{statusCode ? `HTTP ${statusCode}` : 'NETWORK'}</Badge>
        <span className="text-sm font-semibold text-fg">{title}</span>
      </div>
      <p className="mt-2 font-mono text-xs break-all text-fg-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-3" onClick={onRetry}>
          다시 시도
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-page font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 max-w-prose text-xs text-fg-muted">{description}</p>
    </div>
  );
}

/** 표 껍데기. 좁은 화면에서 스스로 스크롤해 페이지가 가로로 밀리지 않게 한다. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left text-2xs font-medium tracking-[0.04em] whitespace-nowrap text-fg-subtle uppercase ${className}`}
    >
      {children}
    </th>
  );
}

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role?: string;
}

export function MemberTable({
  members,
  onRemove,
  busyUserId,
}: {
  members: MemberRow[];
  onRemove: (userId: string) => void;
  busyUserId?: string | null;
}) {
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>사용자</Th>
            <Th>Role</Th>
            <Th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId} className="border-t border-line hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <div className="font-medium text-fg">{member.displayName}</div>
                <div className="font-mono text-xs text-fg-subtle">{member.email}</div>
              </td>
              <td className="px-4 py-2.5">
                {member.role ? <Badge tone="accent">{member.role}</Badge> : null}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button
                  variant="danger"
                  disabled={busyUserId === member.userId}
                  onClick={() => onRemove(member.userId)}
                >
                  제거
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
