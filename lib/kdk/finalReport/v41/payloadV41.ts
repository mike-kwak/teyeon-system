// TEYEON FINAL REPORT V4.1 — edition 3 공개본(공개 정보만 · 정산 없음).
//
//   공개본 = v2 공개본(schema 1 공통 필드 · 헤드라인 · 기록 · 주요 경기 · 순위) + edition 3 + v41(매거진 전용 공개 필드).
//   ⚠ 정산 · 금액 · 계좌 정보는 넣지 않는다(회원 전용 스냅샷은 별도 표). 아래 금지어가 공개본에 있으면 발행 거부(SQL 과 같은 규칙).
//   ⚠ 코드가 이전 판으로 되돌아가도 schema 1 공통 필드로 기본 화면이 나오도록 공통 필드를 유지한다.

import {
  buildFinalReportPayload, type FinalReportContent, type FinalReportModel, type FinalReportPublicPayload, type PayloadReject, FR_PAYLOAD_MAX_BYTES,
} from '../finalReportModel';
import { buildV41Story, v42Headline, type V41Context } from './storyV41';
import { heroIndex } from '../finalReportView';
import type { V41Public } from './publicV41';
export { parseV41Public, type V41Public } from './publicV41';

/** SQL publish_kdk_final_report_v41 의 공개본 금지어와 같다. */
export const V41_PUBLIC_FORBIDDEN = /(penalt|settle|벌금|정산|납부|미납|amount|account|계좌|charged|unpaid)/i;

export type FinalReportV41Payload = FinalReportPublicPayload & { edition: 3; v41: V41Public };

export function buildFinalReportPayloadV41(model: FinalReportModel, content: FinalReportContent, ctx: V41Context):
  { ok: true; payload: FinalReportV41Payload } | { ok: false; reason: PayloadReject | 'settlement_word' } {
  const base = buildFinalReportPayload(model, content);
  if (!base.ok) return base as { ok: false; reason: PayloadReject };
  // V4.2(신규 발행본): 7장 판형 표시(layout=2) · MATCH OF THE DAY 경기는 다른 장에서 반복하지 않는다 · CLOSING 제목.
  //   판본 번호(edition)는 SQL 규칙대로 3 그대로. 기존 발행본(layout 없음)은 V4.1 8장 판형으로 그대로 보인다.
  const f = base.payload.featured;
  const motd = f.length ? f[heroIndex(f)] : null;
  const motdId = motd ? model.matches.find((m) => m.round === motd.round && m.court === motd.court && m.score1 === motd.score1 && m.score2 === motd.score2
    && m.teamA.join('|') === motd.teamA.join('|') && m.teamB.join('|') === motd.teamB.join('|'))?.matchId : undefined;
  const v41 = { ...buildV41Story(model, ctx, { layout: 2, excludeMatchIds: motdId ? [motdId] : [] }), closingTitle: content.closingTitle || null };
  // 자동 헤드라인(운영진이 비운 경우)만: 01 장의 큰 우승자 이름을 되풀이하지 않는 문장으로.
  const champ = model.standings[0]?.name ?? '';
  const headline = content.headline ? base.payload.headline : v42Headline(base.payload.headline ?? '', champ, model.participantCount);
  const payload: FinalReportV41Payload = { ...base.payload, headline, edition: 3, v41 };
  if (V41_PUBLIC_FORBIDDEN.test(JSON.stringify(payload))) return { ok: false, reason: 'settlement_word' };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > FR_PAYLOAD_MAX_BYTES) return { ok: false, reason: 'payload_too_large' };
  return { ok: true, payload };
}
