// Tournament Schedule 전용 서비스 — tournament_events / tournament_pairs / tournament_partner_requests 테이블 대상.
// TODO: Club Schedule (정모/KDK/번개 등) 은 club_events 별도 테이블 + clubScheduleService.ts 로 분리 예정.
import { supabase } from './supabase';
import {
  TournamentDivision,
  TournamentEvent,
  TournamentOrganizer,
  TournamentPair,
  TournamentPartnerRequest,
  TournamentStatus,
} from './tournamentCalendarData';

type TournamentEventRow = {
  id: string;
  title: string;
  event_date: string;
  venue: string | null;
  organizer: TournamentOrganizer;
  division: TournamentDivision;
  grade: string | null;
  registration_start: string | null;
  status: TournamentStatus;
  memo: string | null;
};

type TournamentPairRow = {
  id: string;
  event_id: string;
  player1_name: string;
  player2_name: string;
  result: TournamentPair['result'] | null;
  sort_order: number | null;
};

type TournamentPartnerRequestRow = {
  id: string;
  event_id: string;
  name: string;
  memo: string | null;
  sort_order: number | null;
};

export type TournamentEventInput = Omit<TournamentEvent, 'id' | 'lookingForPartners'> & {
  id?: string;
  partnerRequests: TournamentPartnerRequest[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value));
}

function toEvent(
  event: TournamentEventRow,
  pairRows: TournamentPairRow[],
  requestRows: TournamentPartnerRequestRow[]
): TournamentEvent {
  const pairs = pairRows
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map<TournamentPair>((pair) => ({
      id: pair.id,
      player1: pair.player1_name,
      player2: pair.player2_name,
      result: pair.result || undefined,
    }));

  const partnerRequests = requestRows
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map<TournamentPartnerRequest>((request) => ({
      id: request.id,
      name: request.name,
      memo: request.memo || undefined,
    }));

  return {
    id: event.id,
    title: event.title,
    date: event.event_date,
    venue: event.venue || '',
    organizer: event.organizer,
    division: event.division,
    grade: event.grade || undefined,
    registrationStart: event.registration_start || undefined,
    status: event.status,
    memo: event.memo || undefined,
    pairs,
    lookingForPartners: partnerRequests.map((request) => request.name),
    partnerRequests,
  };
}

export async function fetchTournamentEvents() {
  const { data: eventRows, error: eventError } = await supabase
    .from('tournament_events')
    .select('id, title, event_date, venue, organizer, division, grade, registration_start, status, memo')
    .order('event_date', { ascending: true })
    .order('title', { ascending: true });

  if (eventError) throw eventError;
  if (!eventRows || eventRows.length === 0) return [];

  const eventIds = eventRows.map((event) => event.id);

  const [{ data: pairRows, error: pairError }, { data: requestRows, error: requestError }] = await Promise.all([
    supabase
      .from('tournament_pairs')
      .select('id, event_id, player1_name, player2_name, result, sort_order')
      .in('event_id', eventIds)
      .order('sort_order', { ascending: true }),
    supabase
      .from('tournament_partner_requests')
      .select('id, event_id, name, memo, sort_order')
      .in('event_id', eventIds)
      .order('sort_order', { ascending: true }),
  ]);

  if (pairError) throw pairError;
  if (requestError) throw requestError;

  return (eventRows as TournamentEventRow[]).map((event) =>
    toEvent(
      event,
      ((pairRows || []) as TournamentPairRow[]).filter((pair) => pair.event_id === event.id),
      ((requestRows || []) as TournamentPartnerRequestRow[]).filter((request) => request.event_id === event.id)
    )
  );
}

export async function saveTournamentEvent(input: TournamentEventInput, userId?: string) {
  const eventPayload = {
    title: input.title.trim(),
    event_date: input.date,
    venue: input.venue.trim() || null,
    organizer: input.organizer,
    division: input.division,
    grade: input.grade?.trim() || null,
    registration_start: input.registrationStart || null,
    status: input.status,
    memo: input.memo?.trim() || null,
    updated_by: userId || null,
  };

  const eventId = isUuid(input.id) ? input.id : undefined;
  const eventResult = eventId
    ? await supabase
        .from('tournament_events')
        .update(eventPayload)
        .eq('id', eventId)
        .select('id')
        .single()
    : await supabase
        .from('tournament_events')
        .insert([{ ...eventPayload, created_by: userId || null }])
        .select('id')
        .single();

  if (eventResult.error) throw eventResult.error;

  const savedEventId = eventResult.data.id as string;

  const [{ error: pairDeleteError }, { error: requestDeleteError }] = await Promise.all([
    supabase.from('tournament_pairs').delete().eq('event_id', savedEventId),
    supabase.from('tournament_partner_requests').delete().eq('event_id', savedEventId),
  ]);

  if (pairDeleteError) throw pairDeleteError;
  if (requestDeleteError) throw requestDeleteError;

  const pairPayload = input.pairs
    .map((pair, index) => ({
      event_id: savedEventId,
      player1_name: pair.player1.trim(),
      player2_name: pair.player2.trim(),
      result: pair.result || null,
      sort_order: index,
    }))
    .filter((pair) => pair.player1_name && pair.player2_name);

  const requestPayload = input.partnerRequests
    .map((request, index) => ({
      event_id: savedEventId,
      name: request.name.trim(),
      memo: request.memo?.trim() || null,
      sort_order: index,
    }))
    .filter((request) => request.name);

  if (pairPayload.length > 0) {
    const { error } = await supabase.from('tournament_pairs').insert(pairPayload);
    if (error) throw error;
  }

  if (requestPayload.length > 0) {
    const { error } = await supabase.from('tournament_partner_requests').insert(requestPayload);
    if (error) throw error;
  }

  return savedEventId;
}

// CSV 업로드 시 사용 — 이벤트 메타데이터만 업데이트하고 pairs/partner_requests는 보존
export async function updateTournamentEventMeta(
  eventId: string,
  input: TournamentEventInput,
  userId?: string
): Promise<void> {
  const { error } = await supabase
    .from('tournament_events')
    .update({
      title: input.title.trim(),
      event_date: input.date,
      venue: input.venue?.trim() || null,
      organizer: input.organizer,
      division: input.division,
      grade: input.grade?.trim() || null,
      registration_start: input.registrationStart || null,
      status: input.status,
      memo: input.memo?.trim() || null,
      updated_by: userId || null,
    })
    .eq('id', eventId);

  if (error) throw error;
}

export async function deleteTournamentEvent(eventId: string) {
  if (!isUuid(eventId)) {
    throw new Error('DB에 저장된 대회만 삭제할 수 있습니다.');
  }

  const { error } = await supabase
    .from('tournament_events')
    .delete()
    .eq('id', eventId);

  if (error) throw error;
}
