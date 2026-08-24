'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from './session';
import { Badge, ErrorState, LoadingState, Select } from './ui';

/**
 * 아직 없는 라우트는 노출하지 않는다.
 * 이후 Harness 운영 / 분석 / 승인 그룹이 같은 형태로 추가된다.
 */
const NAV: { label: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  {
    label: '조직 관리',
    items: [
      { href: '/admin/organization', label: '조직', icon: <IconOrg /> },
      { href: '/admin/teams', label: '팀', icon: <IconTeam /> },
      { href: '/admin/projects', label: '프로젝트', icon: <IconProject /> },
      { href: '/admin/groups', label: '그룹', icon: <IconGroup /> },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode }) {
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
                const active = pathname === item.href;
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
                    {o.name}
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
            <ErrorState
              title="소속된 조직이 없습니다"
              message="이 계정은 어느 조직에도 속해 있지 않습니다. 조직을 생성하거나 초대를 받아야 합니다."
            />
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
