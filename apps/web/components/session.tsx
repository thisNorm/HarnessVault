'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Me, type Organization } from '@/lib/api';
import { useResource, type Resource } from '@/lib/use-resource';

interface SessionValue {
  session: Resource<Me>;
  orgId: string | null;
  organization: Organization | null;
  setOrgId: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * 선택한 조직을 브라우저에 남긴다.
 *
 * React state만 쓰면 새로고침은 물론 라우트 그룹을 넘을 때마다 Provider가
 * 다시 마운트되면서 조용히 첫 조직으로 돌아간다. 화면은 그대로인데 다른 조직
 * 데이터를 보게 되고, 그 상태에서 승인을 누르면 엉뚱한 조직의 요청을 처리한다.
 */
const STORAGE_KEY = 'harness.orgId';

function readStoredOrgId(): string | null {
  // 프리렌더 중에는 localStorage가 없다.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서 접근이 막힐 수 있다. 못 읽는 것이 오류는 아니다.
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useResource<Me>(() => api<Me>('/auth/me'), []);
  const [picked, setPicked] = useState<string | null>(null);

  // 마운트 후에 읽는다. 초기값으로 읽으면 서버 렌더와 결과가 달라진다.
  useEffect(() => {
    setPicked(readStoredOrgId());
  }, []);

  useEffect(() => {
    if (session.error?.statusCode === 401) router.replace('/login');
  }, [session.error, router]);

  const value = useMemo<SessionValue>(() => {
    const orgs = session.data?.organizations ?? [];
    // 저장된 조직에서 빠졌을 수 있다. 없으면 조용히 첫 조직으로 떨어진다.
    const organization = orgs.find((o) => o.id === picked) ?? orgs[0] ?? null;
    return {
      session,
      orgId: organization?.id ?? null,
      organization,
      setOrgId: (id: string) => {
        setPicked(id);
        try {
          window.localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // 저장하지 못해도 이번 세션 동안은 동작한다.
        }
      },
    };
  }, [session, picked]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider 밖에서 useSession 을 사용했다');
  return value;
}

/** AdminShell 이 조직 확보 후에만 children 을 렌더하므로 여기서 null 이 아니다. */
export function useOrgId(): string {
  const { orgId } = useSession();
  if (!orgId) throw new Error('활성 조직이 없다');
  return orgId;
}
