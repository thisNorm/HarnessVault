/**
 * structuredContent를 마크다운으로 옮긴다.
 *
 * `structuredContent`가 Source of Truth이고 형식은 자산 타입마다 다르다(§12).
 * 알 수 없는 형태를 버리지 않는다 — 조용히 빠지면 자산이 사라진 것과 같다.
 */

const NUMBERED_KEYS = ['instructions', 'steps', 'procedure'] as const;
const CHECKLIST_KEYS = ['checks', 'items', 'checklist'] as const;
const PARAGRAPH_KEYS = ['rule', 'body', 'text', 'description'] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function headingFor(key: string): string {
  const labels: Record<string, string> = {
    instructions: '절차',
    steps: '단계',
    procedure: '절차',
    checks: '점검 항목',
    items: '항목',
    checklist: '점검 항목',
    rule: '규칙',
    body: '내용',
    text: '내용',
    description: '설명',
  };
  return labels[key] ?? key;
}

export function renderStructuredContent(content: unknown): string {
  if (content === null || content === undefined) return '_내용이 없습니다._';
  if (typeof content === 'string') return content.trim();
  if (typeof content !== 'object') return String(content);

  if (Array.isArray(content)) {
    return isStringArray(content)
      ? content.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : fence(content);
  }

  const record = content as Record<string, unknown>;
  const sections: string[] = [];
  const handled = new Set<string>();

  for (const key of NUMBERED_KEYS) {
    const value = record[key];
    if (!isStringArray(value) || value.length === 0) continue;
    handled.add(key);
    sections.push(
      `**${headingFor(key)}**\n\n${value.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    );
  }

  for (const key of CHECKLIST_KEYS) {
    const value = record[key];
    if (!isStringArray(value) || value.length === 0) continue;
    handled.add(key);
    sections.push(`**${headingFor(key)}**\n\n${value.map((item) => `- [ ] ${item}`).join('\n')}`);
  }

  for (const key of PARAGRAPH_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    handled.add(key);
    sections.push(value.trim());
  }

  // 처리하지 못한 키는 통째로 싣는다. 버리지 않는다.
  const rest = Object.fromEntries(
    Object.entries(record).filter(([key]) => !handled.has(key)),
  );
  if (Object.keys(rest).length > 0) sections.push(fence(rest));

  return sections.length > 0 ? sections.join('\n\n') : '_내용이 없습니다._';
}

function fence(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
