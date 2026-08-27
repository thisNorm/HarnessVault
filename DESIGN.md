# HarnessVault 콘솔 — 디자인 시스템

이 파일이 단일 진실 원천이다. 컴포넌트에 생 hex나 임의 간격을 쓰지 않는다.
필요한 값이 없으면 **여기에 토큰을 먼저 추가하고** 쓴다.

---

## 1. Atmosphere — 서명

**관제실.** 화면은 무광 흑연 판 위에 놓이고, 크롬은 조용하며, **색은 오직 상태를 뜻할 때만** 켜진다.
승인·거부·대기가 한눈에 갈려야 하는 도구이므로 장식적 색을 쓰지 않는다.
깊이는 그림자가 아니라 **표면 밝기의 단계**로 만든다 — 어두운 배경에서 드롭섀도는 탁해진다.

한 문장으로: *조용한 흑연, 상태만 빛난다.*

---

## 2. Color

### 표면 — 밝기로 층을 만든다 (그림자 아님)

| 토큰 | 값 | 역할 |
| --- | --- | --- |
| `--color-bg` | `#0A0C10` | 창 바닥. 사이드바·헤더가 여기 앉는다 |
| `--color-surface` | `#0F1218` | 본문 판. 카드·패널 |
| `--color-surface-2` | `#151922` | 카드 안 한 단 위 (입력창, 코드블록) |
| `--color-surface-3` | `#1C2130` | 호버·선택 |

### 경계

| 토큰 | 값 | 역할 |
| --- | --- | --- |
| `--color-line` | `rgba(255,255,255,.07)` | 기본 구분선 |
| `--color-line-strong` | `rgba(255,255,255,.13)` | 입력창 테두리, 강조 구분 |

### 전경

| 토큰 | 값 | 대비(bg 대비) | 역할 |
| --- | --- | --- | --- |
| `--color-fg` | `#E8EBF0` | 15.2:1 | 본문·제목 |
| `--color-fg-muted` | `#9AA4B8` | 7.1:1 | 보조 설명 |
| `--color-fg-subtle` | `#6B7488` | 4.6:1 | 라벨·메타 (4.5:1 통과) |

순백(`#FFF`)을 쓰지 않는다. 어두운 배경에서 눈이 아프고 계층이 죽는다.

### Accent — 하나만, 상호작용에만

| 토큰 | 값 | 역할 |
| --- | --- | --- |
| `--color-accent` | `#2E90FA` | 주 동작 버튼, 활성 항목, 링크 |
| `--color-accent-hover` | `#4AA3FB` | 호버 |
| `--color-accent-press` | `#1B7AE0` | 눌림 |
| `--color-accent-fg` | `#04121F` | accent 위 글자 (흰색 아님 — 대비 9.8:1) |
| `--color-accent-dim` | `rgba(46,144,250,.12)` | 활성 배경, 선택 |
| `--color-accent-line` | `rgba(46,144,250,.35)` | 활성 테두리 |

**왜 파랑인가.** 아래 상태색이 초록·호박·빨강을 이미 점유한다. 보라는 금지(§anti-slop),
초록·호박·빨강은 의미 충돌. 남는 색상환에서 파랑이 유일하게 안전하다.
멋보다 **상태 판독이 우선인 도구**라 이 선택이 맞다.

### 상태 — 의미를 지닌 색. 장식으로 쓰지 않는다

| 토큰 | 값 | 뜻 |
| --- | --- | --- |
| `--color-ok` | `#3DD68C` | 승인됨 · ACTIVE · 충족 |
| `--color-ok-dim` | `rgba(61,214,140,.12)` | 배지 배경 |
| `--color-warn` | `#F0B429` | 대기 · 검토 필요 |
| `--color-warn-dim` | `rgba(240,180,41,.12)` | |
| `--color-danger` | `#F76D6D` | 거부 · 실패 · DENY |
| `--color-danger-dim` | `rgba(247,109,109,.12)` | |
| `--color-neutral` | `#7C8497` | 잠김 · 만료 · 취소 |
| `--color-neutral-dim` | `rgba(124,132,151,.12)` | |

---

## 3. Typography

**Geist**(라틴) + **Pretendard**(한글) + **Geist Mono**(수치·코드·식별자).
Inter를 쓰지 않는다. 한글 비중이 높아 Pretendard가 앞에 서야 자간이 무너지지 않는다.

| 역할 | 크기 | 굵기 | 행간 | 자간 |
| --- | --- | --- | --- | --- |
| `page-title` | 20px | 600 | 1.25 | -0.01em |
| `section-title` | 14px | 600 | 1.4 | -0.005em |
| `body` | 13px | 400 | 1.55 | 0 |
| `label` | 11px | 500 | 1.3 | 0.04em (대문자) |
| `mono` | 12px | 400 | 1.5 | 0 |
| `metric` | 26px | 550 | 1.1 | -0.02em (mono, tabular) |

id·key·SQL·토큰 수는 **전부 mono**. 자릿수가 흔들리면 표에서 눈이 미끄러진다.
숫자는 `font-variant-numeric: tabular-nums`.

---

## 4. Spacing

기준 4px. Tailwind 기본 스케일을 그대로 쓰되 **아래 리듬만 고정**한다.

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `--space-row` | 10px | 표·목록 한 줄의 상하 여백 |
| `--space-card` | 16px | 카드 안쪽 |
| `--space-gap` | 16px | 카드 사이 |
| `--space-page` | 24px | 본문 바깥 여백 |

| 치수 | 값 |
| --- | --- |
| `--w-sidebar` | 224px |
| `--h-header` | 52px |
| `--w-content` | 1180px (본문 최대 폭 — 넓은 화면에서 줄이 길어지지 않게) |

---

## 5. Components

**radius 스케일 하나만 쓴다**: `--r-sm 4px` · `--r-md 7px` · `--r-lg 10px` · `--r-full 999px`.

| 컴포넌트 | 규격 |
| --- | --- |
| `Button/primary` | bg `accent`, fg `accent-fg`, h 30px, px 12, `--r-md`, 600. hover `accent-hover`, active `accent-press` + `translateY(.5px)`, disabled opacity .45 |
| `Button/ghost` | bg `surface-2`, fg `fg`, border `line-strong`. hover bg `surface-3` |
| `Button/danger` | bg transparent, fg `danger`, border `danger` 30%. hover bg `danger-dim` |
| `Input`/`Select` | bg `surface-2`, border `line-strong`, h 30px, `--r-md`, 13px. focus: border `accent`, ring `accent-dim` 3px |
| `Select` | **네이티브 화살표를 지운다**(`appearance:none`) + 자체 chevron. 안 그러면 시스템 크롬이 다크 테마를 깬다 |
| `Card` | bg `surface`, border `line`, `--r-lg`. 헤더: 제목 좌 · 메타 우, 하단 `line` |
| `Badge` | h 18px, px 6, `--r-sm`, 11px/600, mono. 톤별 `*-dim` 배경 + 해당 색 글자 |
| `Table` | 헤더 `label` 스타일, 행 구분은 `line` **하단선만**(세로선 없음), 행 hover `surface-2` |
| `EmptyState` | 아이콘 없이 문장만. 제목 `fg-muted` 13px + 힌트 `fg-subtle` 12px |

### 시그니처 컴포넌트 — `StatusRail`

목록 행 왼쪽에 **2px 세로 막대**로 상태를 표시한다. 배지를 반복해 다는 것보다
훑을 때 빠르고, 색을 한 번만 쓰므로 화면이 조용해진다.

```
[▍] PENDING  db.update  고객 데이터베이스        승인  거부
 ↑ 2px, --color-warn
```

---

## 6. Motion

도구다. 움직임은 **상태가 바뀌었음을 알리는 최소한**만.

| 항목 | 값 |
| --- | --- |
| 기본 전이 | 120ms `cubic-bezier(.2,0,0,1)` |
| 대상 | `background-color`, `border-color`, `color`, `opacity`, `transform` **만** |
| 버튼 눌림 | `translateY(.5px)` |
| 진입 | 없음. 목록이 페이드인하면 데이터가 늦게 오는 것처럼 보인다 |

`prefers-reduced-motion: reduce`에서 모든 transition을 `0s`로 만든다.

---

## 7. Depth

**표면 밝기 단계로만** 만든다. 드롭섀도를 쓰지 않는다 — 어두운 배경에서 탁해지고
"떠 있는 카드" 느낌이 오히려 싸구려로 보인다.

```
bg #0A0C10  →  surface #0F1218  →  surface-2 #151922  →  surface-3 #1C2130
```

떠 있어야 하는 것(드롭다운·모달)만 예외로 `--shadow-pop`
`0 8px 24px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06)`.

---

## Do / Don't

- **Don't** 카드를 겹겹이 중첩하지 않는다. 판 하나에 구분선으로 나눈다.
- **Don't** accent를 상태색 대신 쓰지 않는다. 파랑은 "누를 수 있다"만 뜻한다.
- **Don't** 네이티브 `<select>`를 그대로 두지 않는다. 시스템 크롬이 다크를 깬다.
- **Don't** 본문을 화면 끝까지 늘리지 않는다. `--w-content`에서 멈춘다.
- **Do** 식별자·수치는 mono + tabular.
- **Do** 빈 상태에 왜 비었는지와 다음 행동을 쓴다.
