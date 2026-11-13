// TEYEON FINAL REPORT V4.2 — CLOSING 자동 초안(규칙 기반 · 외부 AI 없음 · 순수 함수).
//
//   운영진 메모(짧은 키워드) → 제목 + 2~3문장 본문 초안. 운영진이 고친 뒤 직접 발행한다(자동 발행 없음).
//   ⚠ 만들지 않는 것: 메모에 없는 날짜 · 요일 · 시간 · 장소 · 참석 규칙. 일정 · 장소는 메모에 적힌 표현 그대로,
//     또는 메모가 '다음 정모'를 언급했고 확정된 다음 정모(confirmedNext)가 있을 때만 그 날짜를 쓴다.
//   ⚠ 취소 · 휴무 · 미정 메모는 '다음 정모 안내'로 바꾸지 않는다(뜻이 뒤집히지 않게).
//   ⚠ 정산 · 금액 관련 표현은 공개 리포트에 넣을 수 없으므로 초안에서 뺀다(발행 거부 규칙과 같음).
//   ⚠ 메모 원문은 저장하지 않는다(편집기 화면 상태만). 발행본에는 운영진이 확정한 제목 · 본문만 들어간다.

export const CLOSING_MEMO_MAX = 120;
export const CLOSING_DRAFT_TITLE_MAX = 30; // = FR_CLOSING_TITLE_MAX
export const CLOSING_DRAFT_BODY_MAX = 90;  // = FR_CLOSING_V42_MAX(V4.2 본문)
export const CLOSING_DRAFT_SENTENCES = 3;

/** SQL · 서버 공개본 금지어와 같은 규칙(payloadV41.V41_PUBLIC_FORBIDDEN) + 회비 등 돈 관련 단어. */
const MONEY_RE = /(penalt|settle|벌금|정산|납부|미납|amount|account|계좌|charged|unpaid|회비|입금|송금|\d[\d,]*\s*(원|만원))/i;
const MEET_RE = /(정모|모임)/;
const ATTEND_RE = /(참석|투표|신청|체크)/;
const CANCEL_RE = /(취소|쉽니다|쉬어요|쉼|휴무|없습니다|없어요|없음)/;
const UNDECIDED_RE = /(미정|추후|정해지면|확정되면)/;
const THANKS_RE = /(고생|수고|감사|고마|땀\s*흘|함께해)/;

export interface ClosingDraftInput {
  memo: string;
  /** 확정된 다음 정모(취소 여부 확인 가능한 일정)만. 없으면 null. */
  confirmedNext?: { date: string; startTime: string | null } | null;
  /** 다시 생성 횟수(0부터) — 같은 메모에서 표현만 바꾼다(사실은 그대로). */
  variant?: number;
}
export interface ClosingDraft {
  title: string;
  body: string;
  /** 운영진에게 보여 줄 안내(빠진 내용 · 확인할 점). */
  notes: string[];
}

const TITLES = [
  '오늘의 승부는 끝, 우리의 테니스는 계속됩니다.',
  '오늘도 코트 위에서 함께였습니다.',
  '수고 많으셨습니다, TEYEON!',
  '다음 코트에서 또 만나요.',
];
const TITLE_YEAR = '올해도 코트 위에서 함께였습니다.';
const THANKS = ['함께 뛰어 주신 모든 분들, 수고 많으셨습니다.', '오늘 함께한 모든 분들, 고생 많으셨습니다.', '끝까지 함께 뛰어 주셔서 고맙습니다.'];
const THANKS_YEAR = ['올해도 함께해 주셔서 감사합니다.', '올 한 해도 함께해 주셔서 고맙습니다.'];
const THANKS_SHORT = '모두 수고 많으셨습니다.';
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const cp = (t: string): number => [...t].length;
const sp = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** 메모 → 조각(쉼표 · 마침표 · 줄바꿈 기준). 시각(7:30) · 날짜(12/6)는 쪼개지 않는다. */
function segments(memo: string): string[] {
  return memo.replace(/[<>]/g, '').split(/[,，\n;!?！？]+|\.(?!\d)|。/).map(sp).filter(Boolean);
}

/** 메모 조각의 일정 표현(메모에 적힌 그대로) — 날짜 · 주 · 요일 · 시각을 적힌 순서로 잇는다. */
export function scheduleOf(seg: string): string | null {
  const parts: Array<[number, string]> = [];
  const take = (re: RegExp) => { const m = re.exec(seg); if (m) parts.push([m.index, sp(m[0])]); return !!m; };
  if (!take(/\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}/)) take(/(그\s*다음\s*주|다다음\s*주|다음\s*주|이번\s*주|내일|모레)(말)?/);
  take(/[월화수목금토일]요일/);
  take(/(오전|오후|저녁|아침|밤)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분|\s*반)?|\b\d{1,2}:\d{2}\b/);
  if (!parts.length) return null;
  return parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' ');
}
/** 장소(메모에 적힌 그대로): '장소는 ○○' 또는 '○○ 코트(에서)'. */
function placeOf(seg: string): string | null {
  const a = /장소\s*(?:는|은|:)?\s*([^,]+?)(?:에서)?\s*$/.exec(seg);
  if (a) return sp(a[1]);
  const b = /([가-힣A-Za-z0-9]+\s?코트)(?:에서)?/.exec(seg);
  return b && !/^(그|이|저)\s?코트$/.test(b[1]) ? sp(b[1]) : null;
}

const fmtConfirmed = (n: { date: string; startTime: string | null }): string => {
  const t = Date.parse(`${n.date}T00:00:00Z`);
  const md = /^\d{4}-(\d{2})-(\d{2})$/.exec(n.date);
  const wd = Number.isFinite(t) ? `(${WEEKDAY[new Date(t).getUTCDay()]})` : '';
  return md ? `${Number(md[1])}월 ${Number(md[2])}일${wd}${n.startTime ? ` ${n.startTime}` : ''}` : n.date;
};

/** 운영진이 쓴 조각을 문장으로(단어는 그대로, 끝맺음만). */
export function politeEnd(seg: string): string {
  let t = sp(seg);
  if (/[.!?]$/.test(t)) return t;
  if (/부탁$/.test(t)) t = `${t}드립니다`;
  else if (/(예정|공지|안내)$/.test(t)) t = `${t}입니다`;
  else if (/환영$/.test(t)) t = `${t}합니다`;
  else if (/(체크|확인|공유|참고)$/.test(t)) t = `${t} 부탁드립니다`;
  else if (/(해요|세요|니다|어요|아요|에요|예요|죠|요|다)$/.test(t)) { /* 이미 문장 */ }
  return `${t}.`;
}

type Item = { text: string; pri: number; order: number };

export function draftClosing(input: ClosingDraftInput): ClosingDraft {
  const notes: string[] = [];
  const v = Math.max(0, Math.floor(input.variant ?? 0));
  const memo = (input.memo ?? '').slice(0, CLOSING_MEMO_MAX);
  const segs = segments(memo);
  const items: Item[] = [];
  let thanks = false; let year = /(올해|올 한 해|연말|송년)/.test(memo); let dropped = false; let attendDone = false;
  const attendText = (seg: string) => (/투표/.test(seg) ? '참석 투표도 잊지 마세요.' : /신청/.test(seg) ? '참석 신청도 잊지 마세요.' : '참석 체크도 잊지 마세요.');

  segs.forEach((seg, order) => {
    if (MONEY_RE.test(seg)) { dropped = true; return; }
    // 정모 일정(취소 · 미정 · 날짜 · 확정 일정)
    if (MEET_RE.test(seg) && !/(송년|번개|대회|행사)/.test(seg)) {
      const when = scheduleOf(seg); const place = placeOf(seg);
      if (CANCEL_RE.test(seg)) {
        const cause = /^(.*?(때문에|로 인해|으로 인해))\s/.exec(seg)?.[1];
        items.push({ text: `${cause ? `${sp(cause)} ` : ''}${when ? `${when} ` : ''}정모는 ${/취소/.test(seg) ? '취소됩니다' : '쉽니다'}.`, pri: 1, order });
      } else if (UNDECIDED_RE.test(seg)) {
        items.push({ text: '다음 정모 일정은 정해지는 대로 안내드릴게요.', pri: 1, order });
      } else if (when || place) {
        items.push({ text: `다음 정모는 ${[when, place].filter(Boolean).join(', ')}!`, pri: 1, order });
        if (!when) notes.push('메모에 날짜 · 시간이 없어 장소만 넣었습니다.');
      } else if (input.confirmedNext) {
        items.push({ text: `다음 정모는 ${fmtConfirmed(input.confirmedNext)}!`, pri: 1, order });
        notes.push('메모에 일정이 없어 등록된 다음 정모 일정을 넣었습니다.');
      } else {
        items.push({ text: '다음 정모에서 만나요!', pri: 1, order });
        notes.push('확정된 다음 정모 일정이 없어 날짜 없이 안내했습니다.');
      }
      if (ATTEND_RE.test(seg) && !attendDone) { items.push({ text: attendText(seg), pri: 2, order: order + 0.5 }); attendDone = true; }
      return;
    }
    if (ATTEND_RE.test(seg) && !/(송년|번개|대회|행사|공지)/.test(seg)) { if (!attendDone) items.push({ text: attendText(seg), pri: 2, order }); attendDone = true; return; }
    if (THANKS_RE.test(seg) && cp(seg) <= 20 && !/(공사|취소|쉽니다)/.test(seg)) { thanks = true; if (/올해|올 한 해/.test(seg)) year = true; return; }
    if (/(우승|입상)/.test(seg) && /축하/.test(seg)) { items.push({ text: /입상/.test(seg) ? '입상하신 분들, 축하드립니다!' : '우승을 축하드립니다!', pri: 4, order }); return; }
    if (/환영/.test(seg) && /(신입|새\s*회원|첫)/.test(seg)) { items.push({ text: /신입/.test(seg) ? '신입 회원님, 환영합니다!' : politeEnd(seg), pri: 4, order }); return; }
    if (UNDECIDED_RE.test(seg) && /(일정|날짜)/.test(seg)) { items.push({ text: '다음 일정은 정해지는 대로 안내드릴게요.', pri: 1, order }); return; }
    items.push({ text: politeEnd(seg), pri: 3, order });
  });
  if (dropped) notes.push('정산 · 금액 관련 내용은 공개 리포트에 넣을 수 없어 초안에서 뺐습니다.');
  if (!segs.length) notes.push('메모가 비어 있어 기본 인사로 만들었습니다.');

  // 같은 문장 반복 제거
  const seen = new Set<string>();
  let core = items.sort((a, b) => a.order - b.order).filter((x) => { if (seen.has(x.text)) return false; seen.add(x.text); return true; });
  // 인사는 맨 앞 · 가장 낮은 우선순위(5). 메모에 인사가 없어도 다른 문장이 없으면 기본 인사.
  if (thanks || !core.length) core = [{ text: year ? THANKS_YEAR[v % THANKS_YEAR.length] : THANKS[v % THANKS.length], pri: 5, order: -1 }, ...core];
  const build = (c: Item[]) => c.map((x) => x.text).join(' ');
  const removed: string[] = [];
  const dropWorst = () => {
    const worst = core.reduce((w, x) => (x.pri > w.pri || (x.pri === w.pri && x.order > w.order) ? x : w), core[0]);
    removed.push(worst.text); core = core.filter((x) => x !== worst);
  };
  // 1) 3문장까지 — 우선순위 낮은 문장(인사 → 축하 · 환영 → 운영진 메모 → 참석)부터 뺀다. 일정 문장이 가장 오래 남는다.
  while (core.length > CLOSING_DRAFT_SENTENCES) dropWorst();
  // 2) 90자까지 — 인사를 짧게 바꾼 뒤에도 길면 같은 순서로 뺀다(문장 중간에서 자르지 않음).
  while (cp(build(core)) > CLOSING_DRAFT_BODY_MAX && core.length > 1) {
    const gi = core.findIndex((x) => x.pri === 5 && x.text !== THANKS_SHORT);
    if (gi >= 0) { core[gi] = { ...core[gi], text: THANKS_SHORT }; continue; }
    dropWorst();
  }
  let body = build(core);
  if (cp(body) > CLOSING_DRAFT_BODY_MAX) { body = [...body].slice(0, CLOSING_DRAFT_BODY_MAX).join(''); notes.push('본문이 길어 끝을 잘랐습니다. 직접 줄여 주세요.'); }
  const lost = removed.filter((t) => !THANKS.includes(t) && !THANKS_YEAR.includes(t) && t !== THANKS_SHORT);
  if (lost.length) notes.push(`3문장 · ${CLOSING_DRAFT_BODY_MAX}자에 맞추느라 뺀 내용: ${lost.join(' / ')}`);
  const title = year && v === 0 ? TITLE_YEAR : TITLES[v % TITLES.length];
  return { title, body, notes };
}

/** 초안의 날짜 · 시간 표현(테스트 · 편집기 경고용). */
export function scheduleTokens(text: string): string[] {
  return [...text.matchAll(/(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}|[월화수목금토일]요일|\d{1,2}\s*시|\d{1,2}:\d{2})/g)].map((m) => m[0].replace(/\s+/g, ''));
}
