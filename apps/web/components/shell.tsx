'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { orgLabel } from '@/lib/org-label';
import { api } from '@/lib/api';
import { CreateOrganization } from './create-organization';
import { useSession } from './session';
import { Badge, ErrorState, LoadingState, Select } from './ui';

/**
 * 아직 없는 라우트는 노출하지 않는다.
 * 이후 Resolve / Traces / Candidates / Approvals / Analytics가 같은 형태로 추가된다.
 *
 * 자산은 타입별로 메뉴를 쪼개지 않는다. `type`은 필드이므로 목록의 패싯이다.
 */
const NAV: { label: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  {
    label: 'Governance',
    items: [
      { href: '/approvals', label: '승인함', icon: <IconApproval /> },
      { href: '/traces', label: 'Traces', icon: <IconTrace /> },
      { href: '/analytics', label: 'Analytics', icon: <IconAnalytics /> },
    ],
  },
  {
    label: 'Harness',
    items: [
      { href: '/resolve', label: 'Resolve', icon: <IconResolve /> },
      { href: '/assets', label: '자산', icon: <IconAsset /> },
      { href: '/candidates', label: 'Candidates', icon: <IconCandidate /> },
    ],
  },
  {
    label: '조직 관리',
    items: [
      { href: '/admin/organization', label: '조직', icon: <IconOrg /> },
      { href: '/admin/teams', label: '팀', icon: <IconTeam /> },
      { href: '/admin/projects', label: '프로젝트', icon: <IconProject /> },
      { href: '/admin/groups', label: '그룹', icon: <IconGroup /> },
    ],
  },
  {
    label: '정책 · 자원',
    items: [
      { href: '/admin/resources', label: 'Resources', icon: <IconResource /> },
      { href: '/admin/policies', label: 'Policies', icon: <IconPolicy /> },
      { href: '/admin/output-contracts', label: '산출물 계약', icon: <IconContract /> },
    ],
  },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, organization, orgId, setOrgId } = useSession();
  const router = useRouter();

  async function logout() {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  }

  const orgs = session.data?.organizations ?? [];

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 flex w-sidebar flex-col border-r border-border bg-bg-raised">
        <div className="flex h-header items-center gap-2 border-b border-border px-4">
          <span className="size-4 rounded-xs border border-accent/60 bg-accent-soft" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">HarnessVault</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`mb-0.5 flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-accent-soft text-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    <span className={active ? 'text-accent-text' : 'text-fg-subtle'}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="pl-sidebar">
        <header className="sticky top-0 z-10 flex h-header items-center justify-between gap-4 border-b border-border bg-bg/85 px-5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2.5">
            {orgs.length > 1 ? (
              <Select
                aria-label="조직 선택"
                value={orgId ?? ''}
                onChange={(e) => setOrgId(e.target.value)}
                className="max-w-56"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {orgLabel(o, orgs)}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="truncate text-sm font-medium">{organization?.name ?? '조직 없음'}</span>
            )}
            {organization ? (
              <span className="truncate font-mono text-xs text-fg-subtle">{organization.slug}</span>
            ) : null}
            {organization?.role ? <Badge tone="accent">{organization.role}</Badge> : null}
          </div>

          <div className="flex items-center gap-3">
            {session.loading ? (
              <Badge tone="pending">PENDING</Badge>
            ) : session.error ? (
              <Badge tone="deny">DENY</Badge>
            ) : (
              <Badge tone="active">ACTIVE</Badge>
            )}
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg">
                <span className="grid size-5 place-items-center rounded-full border border-border bg-surface text-2xs">
                  {session.data?.user.displayName.slice(0, 1).toUpperCase() ?? '?'}
                </span>
                {session.data?.user.displayName ?? '미인증'}
              </summary>
              <div className="absolute right-0 mt-1.5 w-56 rounded-md border border-border bg-surface p-1 shadow-lg shadow-black/40">
                <p className="truncate px-2 py-1.5 text-xs text-fg-subtle">
                  {session.data?.user.email ?? '세션 없음'}
                </p>
                <button
                  onClick={logout}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
                >
                  로그아웃
                </button>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 py-6">
          {session.loading ? (
            <LoadingState label="세션 확인 중" />
          ) : session.error ? (
            <ErrorState
              title="세션을 확인할 수 없습니다"
              statusCode={session.error.statusCode || undefined}
              message={session.error.message}
              onRetry={session.reload}
            />
          ) : !orgId ? (
            <CreateOrganization />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconTrace() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M2.5 8h3l2-4.5L10 12l1.5-4h2" />
    </svg>
  );
}

function IconApproval() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M3.5 2.5h9v11l-4.5-2.5-4.5 2.5z" />
      <path d="M6 6.5l1.5 1.5L10 5.5" />
    </svg>
  );
}

function IconResource() {
  return (
    <svg {...ICON} aria-hidden>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" />
      <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  );
}

function IconPolicy() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M8 1.8 13.5 4v4.2c0 3-2.3 5.2-5.5 6-3.2-.8-5.5-3-5.5-6V4z" />
      <path d="M6 8l1.5 1.5L10.5 6.5" />
    </svg>
  );
}

function IconResolve() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
    </svg>
  );
}

/** 기여 — 위로 올리는 화살표. 개인 지식이 조직으로 올라간다. */
function IconCandidate() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-4">
      <path d="M8 13V4" strokeLinecap="round" />
      <path d="M4.5 7.5 8 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 2.5h10" strokeLinecap="round" />
    </svg>
  );
}

/** 분석 — 막대 그래프. */
function IconAnalytics() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-4">
      <path d="M2.5 13.5h11" strokeLinecap="round" />
      <path d="M4.5 11V7.5M8 11V3.5M11.5 11V6" strokeLinecap="round" />
    </svg>
  );
}

/** 산출물 계약 — 체크 목록. */
function IconContract() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-4">
      <path d="M3 4.5h2M3 8h2M3 11.5h2" strokeLinecap="round" />
      <path d="M7.5 4.5h5.5M7.5 8h5.5M7.5 11.5h5.5" strokeLinecap="round" />
    </svg>
  );
}

function IconAsset() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M8 1.8 14 5v6l-6 3.2L2 11V5z" />
      <path d="M2 5l6 3.2L14 5M8 8.2v6" />
    </svg>
  );
}

function IconOrg() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M2.5 13.5h11M4 13.5V3.5h5v10M9 6.5h3v7M6 6h1M6 9h1" />
    </svg>
  );
}

function IconTeam() {
  return (
    <svg {...ICON} aria-hidden>
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2.5 13c0-2 1.6-3.3 3.5-3.3S9.5 11 9.5 13M10.8 4.2a2 2 0 0 1 0 3.6M11.5 13c0-1.4-.4-2.4-1.1-3" />
    </svg>
  );
}

function IconProject() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M2.5 4.5A1 1 0 0 1 3.5 3.5h3l1.2 1.6h4.8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function IconGroup() {
  return (
    <svg {...ICON} aria-hidden>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}
