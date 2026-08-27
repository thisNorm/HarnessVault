'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  // 좁은 화면에서 사이드바는 서랍이 된다. 224px을 고정으로 두면 390px에서 본문이 166px만 남는다.
  const [menuOpen, setMenuOpen] = useState(false);

  // 이동하면 서랍을 닫는다. 열린 채로 남으면 도착한 화면을 가린다.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape로 닫는다. 뒷막을 못 누르는 상황(키보드·스크린리더)에서 유일한 탈출구다.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
      {/* 뒷막. 서랍이 열렸을 때만, 좁은 화면에서만. */}
      {menuOpen ? (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-20 bg-bg/70 backdrop-blur-sm md:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-sidebar flex-col border-r border-line bg-surface transition-transform duration-[120ms] md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-header items-center gap-2 border-b border-line px-4">
          <span
            className="grid size-5 place-items-center rounded-md bg-accent text-accent-fg"
            aria-hidden
          >
            <svg viewBox="0 0 16 16" fill="none" className="size-3">
              <path
                d="M8 2.2 13 4.6v3.6c0 2.9-2 5.2-5 6.1-3-.9-5-3.2-5-6.1V4.6L8 2.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight">HarnessVault</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="px-3 pb-2 text-2xs font-medium tracking-[0.08em] text-fg-subtle uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative mb-px flex items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3 text-sm transition-[background-color,color] duration-[120ms] ${
                      active
                        ? 'bg-accent-dim font-medium text-fg'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                    }`}
                  >
                    {/* 활성 표시는 좌측 2px 레일. 블록 전체를 칠하면 목록이 시끄럽다. */}
                    {active ? (
                      <span
                        className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
                        aria-hidden
                      />
                    ) : null}
                    <span className={active ? 'text-accent' : 'text-fg-subtle'}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="md:pl-sidebar">
        <header className="sticky top-0 z-10 flex h-header items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg md:hidden"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />
              </svg>
            </button>
            {orgs.length > 1 ? (
              <Select
                aria-label="조직 선택"
                value={orgId ?? ''}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-40 sm:w-52"
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
            {/* 좁은 화면에서는 숨긴다. 조직 이름이 먼저다. */}
            {organization?.role ? (
              <span className="hidden sm:inline">
                <Badge tone="accent">{organization.role}</Badge>
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg">
                <span className="grid size-[22px] place-items-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-muted">
                  {session.data?.user.displayName.slice(0, 1).toUpperCase() ?? '?'}
                </span>
                <span className="hidden truncate sm:inline">
                  {session.data?.user.displayName ?? '미인증'}
                </span>
              </summary>
              <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-md bg-surface-2 p-1 shadow-pop">
                <p className="truncate px-2 py-1.5 text-xs text-fg-subtle">
                  {session.data?.user.email ?? '세션 없음'}
                </p>
                <button
                  onClick={logout}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
                >
                  로그아웃
                </button>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto max-w-content px-5 py-6 sm:px-6">
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
