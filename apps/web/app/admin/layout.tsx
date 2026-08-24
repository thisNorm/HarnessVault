import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/session';
import { AdminShell } from '@/components/shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
