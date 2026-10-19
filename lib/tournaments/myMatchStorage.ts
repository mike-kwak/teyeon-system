// MY MATCH — 이 브라우저에만 저장하는 값(서버로 보내지 않는다).
//   · 내 팀(teamNo + 선수 두 명 이름)        teyeon:mymatch:v1:<slug>:team
//   · 이미 띄운 알림 지문(중복 방지)          teyeon:mymatch:v1:<slug>:seen:<teamNo>
//   · 알림음 사용 의사                         teyeon:mymatch:v1:sound
//   ⚠ localStorage 를 쓸 수 없는 환경(사생활 보호 모드 · 차단)에서는 조용히 메모리 동작만 한다.
//   ⚠ 저장값을 지우는 코드는 없다. 내 팀은 참가자가 새 팀을 고를 때만 바뀐다(첫 로딩 · 조회 실패 · 비공개 상태에서 그대로).

import type { SavedTeam } from './myMatchModel';

const P = 'teyeon:mymatch:v1';
const SEEN_MAX = 200;

const read = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { window.localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 동작한다 */ } };

export function loadTeam(slug: string): SavedTeam | null {
  const raw = read(`${P}:${slug}:team`);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedTeam>;
    if (typeof o.teamNo !== 'number' || o.teamNo < 1) return null;
    return { teamNo: o.teamNo, player1Name: String(o.player1Name ?? ''), player2Name: String(o.player2Name ?? '') };
  } catch {
    return null;
  }
}

export function saveTeam(slug: string, t: SavedTeam): void {
  write(`${P}:${slug}:team`, JSON.stringify({ teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name, savedAt: new Date().toISOString() }));
}

export function loadSeen(slug: string, teamNo: number): Set<string> {
  const raw = read(`${P}:${slug}:seen:${teamNo}`);
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(slug: string, teamNo: number, seen: Set<string>): void {
  const list = [...seen].slice(-SEEN_MAX);
  write(`${P}:${slug}:seen:${teamNo}`, JSON.stringify(list));
}

export const loadSoundWanted = (): boolean => read(`${P}:sound`) === '1';
export const saveSoundWanted = (on: boolean): void => write(`${P}:sound`, on ? '1' : '0');
