import type { ReactNode } from 'react';

/**
 * 초대 화면은 조직 셸을 쓰지 않는다.
 * 아직 조직 멤버가 아닌 사람이 보므로 사이드바에 조직 메뉴를 띄우면 안 된다.
 */
export default function InvitationLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-10">
      <div className="w-full">{children}</div>
    </main>
  );
}
