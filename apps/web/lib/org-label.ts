/**
 * 조직 선택기에 쓸 표시 이름.
 *
 * 이름이 겹치는 조직이 있으면 slug를 붙인다. 안 붙이면 선택기에
 * 똑같은 항목이 여러 개 보이고 사용자가 무엇을 고르는지 알 수 없다.
 * 겹치지 않으면 이름만 둔다 — 매번 slug를 달면 목록이 소음이 된다.
 */
export function orgLabel(
  organization: { id: string; name: string; slug: string },
  all: readonly { id: string; name: string }[],
): string {
  const duplicated = all.some(
    (other) => other.id !== organization.id && other.name === organization.name,
  );
  return duplicated ? `${organization.name} (${organization.slug})` : organization.name;
}
