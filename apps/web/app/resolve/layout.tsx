import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/session';
import { ConsoleShell } from '@/components/shell';

export default function ResolveLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </SessionProvider>
  );
}
