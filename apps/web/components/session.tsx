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

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useResource<Me>(() => api<Me>('/auth/me'), []);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (session.error?.statusCode === 401) router.replace('/login');
  }, [session.error, router]);

  const value = useMemo<SessionValue>(() => {
    const orgs = session.data?.organizations ?? [];
    const organization = orgs.find((o) => o.id === picked) ?? orgs[0] ?? null;
    return {
      session,
      orgId: organization?.id ?? null,
      organization,
      setOrgId: setPicked,
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
