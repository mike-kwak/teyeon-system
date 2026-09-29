-- =============================================================================
-- ROLLBACK — add_hosted_tournament_bracket_qualifier.sql (Batch 4D-0)
--
--   되돌리는 것
--     · 4D-0 신규 RPC 2개 + 내부 helper 2개
--     · assign_bracket_slot(7인자) 제거 → 5인자 원본(4A) 복원
--     · replace_bracket_slots · hosted_tournament_bracket_validate → 4A 원본
--     · get_admin_bracket → 4C 원본(qualifier 필드 · qualifierDrift 제거)
--     · slot_type CHECK · qualifier 제약 · source unique 인덱스
--       ⚠ qualifier 데이터가 남아 있으면 제약은 되돌리지 않고 NOTICE 만 남긴다.
--
--   되돌리지 않는 것(데이터 손실 방지)
--     · source_kind / source_group_no / source_rank / resolved_at 컬럼 —
--       경기이사가 입력한 본선 경로가 통째로 사라진다.
--     · 이미 만들어진 본선 경기 · 진출팀 스냅샷.
--
--   ⚠ 4C 엔진(materialize · complete_knockout_match · amend_knockout_match_score ·
--     create_match · advance · guard 3종)은 이 Batch 가 건드리지 않았으므로
--     되돌릴 대상도 없다.
--   ⚠ 이 파일에도 기존 행 UPDATE / DELETE 는 없다.
-- =============================================================================

begin;

-- ── 1. 4D-0 전용 함수 제거 ────────────────────────────────────────────────
drop function if exists public.unresolve_bracket_qualifier(text, integer, text, integer);
drop function if exists public.resolve_bracket_qualifiers(text, integer);
drop function if exists public.hosted_tournament_qualifier_downstream(uuid, uuid);
drop function if exists public.assign_bracket_slot(text, uuid, text, uuid, integer, integer, integer);


-- ── 2. 교체된 함수 원복 (4A · 4C 원문) ────────────────────────────────────
create or replace function public.hosted_tournament_bracket_validate(p_bracket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_b        public.hosted_tournament_brackets%rowtype;
    v_issues   jsonb := '[]'::jsonb;
    v_max_round integer;
    v_final_cnt integer;
    v_entrants  integer;
    v_rounds    integer;
    v_slots     integer;
    v_first     integer;
    v_byes      integer;
    v_unassigned integer;
    v_matches   integer;
    v_bye_adv   integer;
    v_tmp       jsonb;
    v_cnt       integer;
begin
    select * into v_b from public.hosted_tournament_brackets where id = p_bracket_id;
    if v_b.id is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_found');
    end if;

    select count(*) into v_entrants from public.hosted_tournament_bracket_entrants where bracket_id = p_bracket_id;
    select count(*) into v_rounds   from public.hosted_tournament_bracket_rounds   where bracket_id = p_bracket_id;
    select count(*) into v_slots    from public.hosted_tournament_bracket_slots    where bracket_id = p_bracket_id;

    if v_entrants = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_entrants', 'severity', 'error'));
    end if;
    if v_rounds = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_rounds', 'severity', 'error'));
    end if;
    if v_slots = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_slots', 'severity', 'error'));
    end if;

    if v_rounds > 0 then
        select max(round_no) into v_max_round
          from public.hosted_tournament_bracket_rounds where bracket_id = p_bracket_id;

        -- 라운드 번호는 1..N 연속이어야 한다.
        if v_max_round <> v_rounds then
            v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                'code', 'round_gap', 'severity', 'error', 'maxRoundNo', v_max_round, 'roundCount', v_rounds));
        end if;

        -- 우승 destination 라운드는 정확히 1개이고, 마지막 라운드이며, 자리가 1개다.
        select count(*) into v_final_cnt
          from public.hosted_tournament_bracket_rounds
         where bracket_id = p_bracket_id and is_final_slot;
        if v_final_cnt <> 1 then
            v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                'code', 'final_round_invalid', 'severity', 'error', 'finalRounds', v_final_cnt));
        else
            select count(*) into v_cnt
              from public.hosted_tournament_bracket_rounds r
              join public.hosted_tournament_bracket_slots s on s.round_id = r.id
             where r.bracket_id = p_bracket_id and r.is_final_slot;
            if v_cnt <> 1 then
                v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                    'code', 'final_round_invalid', 'severity', 'error', 'finalSlots', v_cnt));
            end if;
            if exists (select 1 from public.hosted_tournament_bracket_rounds
                        where bracket_id = p_bracket_id and is_final_slot and round_no <> v_max_round) then
                v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                    'code', 'final_round_invalid', 'severity', 'error', 'reason', 'not_last_round'));
            end if;
        end if;
    end if;

    -- slots.round_no 와 rounds.round_no 불일치
    select coalesce(jsonb_agg(jsonb_build_object('code', 'round_no_mismatch', 'severity', 'error',
                                                 'slotId', s.id, 'slotRoundNo', s.round_no, 'roundNo', r.round_no)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and s.round_no <> r.round_no;
    v_issues := v_issues || v_tmp;

    -- 마지막 라운드가 아닌데 연결이 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'missing_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and not r.is_final_slot and s.feeds_slot_id is null;
    v_issues := v_issues || v_tmp;

    -- 마지막(우승) 라운드 자리는 연결을 가질 수 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'final_slot_has_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and r.is_final_slot and s.feeds_slot_id is not null;
    v_issues := v_issues || v_tmp;

    -- 연결 대상이 다른 bracket / 다음 라운드가 아님
    select coalesce(jsonb_agg(jsonb_build_object(
               'code', case when tgt.bracket_id is distinct from s.bracket_id
                            then 'feed_other_bracket' else 'feed_not_next_round' end,
               'severity', 'error', 'roundNo', s.round_no, 'position', s.position,
               'targetRoundNo', tgt.round_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_slots tgt on tgt.id = s.feeds_slot_id
     where s.bracket_id = p_bracket_id
       and (tgt.bracket_id is distinct from s.bracket_id or tgt.round_no <> s.round_no + 1);
    v_issues := v_issues || v_tmp;

    -- destination 별 feeder 수는 정확히 2 (2라운드 이상 모든 자리)
    select coalesce(jsonb_agg(jsonb_build_object('code', 'feeder_count_invalid', 'severity', 'error',
                                                 'roundNo', t.round_no, 'position', t.position,
                                                 'feeders', coalesce(f.cnt, 0))), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots t
      left join (select feeds_slot_id, count(*) as cnt
                   from public.hosted_tournament_bracket_slots
                  where bracket_id = p_bracket_id and feeds_slot_id is not null
                  group by feeds_slot_id) f on f.feeds_slot_id = t.id
     where t.bracket_id = p_bracket_id and t.round_no > 1 and coalesce(f.cnt, 0) <> 2;
    v_issues := v_issues || v_tmp;

    -- BYE 대 BYE (한 destination 의 feeder 둘 다 bye)
    select coalesce(jsonb_agg(jsonb_build_object('code', 'bye_vs_bye', 'severity', 'error',
                                                 'targetRoundNo', t.round_no, 'targetPosition', t.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots t
      join (select feeds_slot_id,
                   count(*) filter (where slot_type = 'bye') as byes,
                   count(*) as cnt
              from public.hosted_tournament_bracket_slots
             where bracket_id = p_bracket_id and feeds_slot_id is not null
             group by feeds_slot_id) f on f.feeds_slot_id = t.id
     where t.bracket_id = p_bracket_id and f.byes = 2 and f.cnt = 2;
    v_issues := v_issues || v_tmp;

    -- BYE 는 1라운드에만
    select coalesce(jsonb_agg(jsonb_build_object('code', 'bye_outside_first_round', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.slot_type = 'bye' and s.round_no > 1;
    v_issues := v_issues || v_tmp;

    -- 1라운드에 미배치(tbd) 남음 → 운영 시작 불가
    select coalesce(jsonb_agg(jsonb_build_object('code', 'unassigned_first_round_slot', 'severity', 'error',
                                                 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no = 1 and s.slot_type = 'tbd';
    v_issues := v_issues || v_tmp;

    -- 2라운드 이상은 전부 승자 대기(tbd)여야 한다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'non_tbd_future_slot', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position,
                                                 'slotType', s.slot_type)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no > 1 and s.slot_type <> 'tbd';
    v_issues := v_issues || v_tmp;

    -- 배치된 팀이 진출팀 목록에 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'slot_team_not_entrant', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.team_id is not null
       and not exists (select 1 from public.hosted_tournament_bracket_entrants e
                        where e.bracket_id = p_bracket_id and e.team_id = s.team_id);
    v_issues := v_issues || v_tmp;

    -- 확정했는데 자리에 없는 진출팀
    select coalesce(jsonb_agg(jsonb_build_object('code', 'entrant_not_placed', 'severity', 'error',
                                                 'teamNo', t.team_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = p_bracket_id
       and not exists (select 1 from public.hosted_tournament_bracket_slots s
                        where s.bracket_id = p_bracket_id and s.team_id = e.team_id);
    v_issues := v_issues || v_tmp;

    -- ── warning ──────────────────────────────────────────────────────────
    if v_b.declared_entrant_count is not null and v_b.declared_entrant_count <> v_entrants then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'declared_count_mismatch', 'severity', 'warning',
            'declared', v_b.declared_entrant_count, 'actual', v_entrants));
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'entrant_team_withdrawn', 'severity', 'warning',
                                                 'teamNo', t.team_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = p_bracket_id and t.status = 'withdrawn';
    v_issues := v_issues || v_tmp;

    -- ── summary ──────────────────────────────────────────────────────────
    select count(*) filter (where round_no = 1),
           count(*) filter (where round_no = 1 and slot_type = 'bye'),
           count(*) filter (where round_no = 1 and slot_type = 'tbd')
      into v_first, v_byes, v_unassigned
      from public.hosted_tournament_bracket_slots where bracket_id = p_bracket_id;

    -- 만들 수 있는 경기 수 / BYE 로 자동 진출할 자리 수 (4C 가 실행한다 — 여기서는 세기만 한다)
    select count(*) filter (where teams = 2), count(*) filter (where teams = 1 and byes = 1)
      into v_matches, v_bye_adv
      from (select feeds_slot_id,
                   count(*) filter (where slot_type = 'team') as teams,
                   count(*) filter (where slot_type = 'bye')  as byes
              from public.hosted_tournament_bracket_slots
             where bracket_id = p_bracket_id and feeds_slot_id is not null
             group by feeds_slot_id) q;

    return jsonb_build_object(
        'ok', not exists (select 1 from jsonb_array_elements(v_issues) i
                           where i ->> 'severity' = 'error'),
        'issues', v_issues,
        'summary', jsonb_build_object(
            'entrants',        v_entrants,
            'rounds',          v_rounds,
            'slots',           v_slots,
            'firstRoundSlots', v_first,
            'byes',            v_byes,
            'unassigned',      v_unassigned,
            'matchesToCreate', v_matches,
            'byeAdvances',     v_bye_adv));
end;
$$;

revoke execute on function public.hosted_tournament_bracket_validate(uuid) from public;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from anon;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from authenticated;

create or replace function public.assign_bracket_slot(
    p_slug             text,
    p_slot_id          uuid,
    p_slot_type        text,
    p_team_id          uuid,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_bid     uuid;
    v_version integer;
    v_s       public.hosted_tournament_bracket_slots%rowtype;
    v_eid     uuid;
    v_before  jsonb;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_slot_type not in ('team', 'bye', 'tbd') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_slot_type');
    end if;
    if (p_slot_type = 'team') <> (p_team_id is not null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    select * into v_s from public.hosted_tournament_bracket_slots
     where id = p_slot_id and bracket_id = v_bid;
    if v_s.id is null then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_s.round_no > 1 then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_editable', 'roundNo', v_s.round_no);
    end if;

    if p_slot_type = 'team' then
        select id into v_eid from public.hosted_tournament_bracket_entrants
         where bracket_id = v_bid and team_id = p_team_id;
        if v_eid is null then
            return jsonb_build_object('ok', false, 'reason', 'team_not_entrant');
        end if;
        if exists (select 1 from public.hosted_tournament_bracket_slots
                    where bracket_id = v_bid and team_id = p_team_id and id <> p_slot_id) then
            return jsonb_build_object('ok', false, 'reason', 'team_already_placed');
        end if;
    end if;

    v_before := jsonb_build_object('slotType', v_s.slot_type, 'teamId', v_s.team_id);

    update public.hosted_tournament_bracket_slots
       set slot_type = p_slot_type,
           team_id   = case when p_slot_type = 'team' then p_team_id else null end,
           entrant_id = case when p_slot_type = 'team' then v_eid else null end,
           updated_at = now()
     where id = p_slot_id;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket_slot', p_slot_id, 'assign_slot', v_before,
        jsonb_build_object('slotType', p_slot_type, 'teamId', p_team_id,
                           'position', v_s.position), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'slot', jsonb_build_object('id', p_slot_id, 'roundNo', v_s.round_no,
                                                         'position', v_s.position, 'slotType', p_slot_type));
end;
$$;

revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from public;
revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from anon;
grant  execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) to authenticated;

create or replace function public.replace_bracket_slots(
    p_slug             text,
    p_assignments      jsonb,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_bid     uuid;
    v_version integer;
    v_a       jsonb;
    v_pos     integer;
    v_type    text;
    v_team    uuid;
    v_first   integer;
    v_assigned integer;
    v_byes    integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    select count(*) into v_first
      from public.hosted_tournament_bracket_slots where bracket_id = v_bid and round_no = 1;
    if v_first = 0 then
        return jsonb_build_object('ok', false, 'reason', 'structure_missing');
    end if;
    if jsonb_array_length(p_assignments) <> v_first then
        return jsonb_build_object('ok', false, 'reason', 'position_count_mismatch',
                                  'expected', v_first, 'actual', jsonb_array_length(p_assignments));
    end if;

    drop table if exists _bassign;
    create temp table _bassign (position integer, slot_type text, team_id uuid) on commit drop;

    for v_a in select * from jsonb_array_elements(p_assignments) loop
        v_pos  := nullif(v_a ->> 'position', '')::integer;
        v_type := coalesce(v_a ->> 'type', '');
        v_team := nullif(v_a ->> 'teamId', '')::uuid;
        if v_pos is null or v_type not in ('team', 'bye', 'tbd') then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
        end if;
        if (v_type = 'team') <> (v_team is not null) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'position', v_pos);
        end if;
        if exists (select 1 from _bassign where position = v_pos) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_position', 'position', v_pos);
        end if;
        if v_team is not null and exists (select 1 from _bassign where team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_team', 'teamId', v_team);
        end if;
        if not exists (select 1 from public.hosted_tournament_bracket_slots
                        where bracket_id = v_bid and round_no = 1 and position = v_pos) then
            return jsonb_build_object('ok', false, 'reason', 'unknown_position', 'position', v_pos);
        end if;
        if v_team is not null and not exists (
               select 1 from public.hosted_tournament_bracket_entrants
                where bracket_id = v_bid and team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'team_not_entrant', 'teamId', v_team);
        end if;
        insert into _bassign values (v_pos, v_type, v_team);
    end loop;

    -- 전량 반영
    update public.hosted_tournament_bracket_slots s
       set slot_type = a.slot_type,
           team_id   = a.team_id,
           entrant_id = e.id,
           updated_at = now()
      from _bassign a
      left join public.hosted_tournament_bracket_entrants e
        on e.bracket_id = v_bid and e.team_id = a.team_id
     where s.bracket_id = v_bid and s.round_no = 1 and s.position = a.position;

    select count(*) filter (where slot_type = 'team'), count(*) filter (where slot_type = 'bye')
      into v_assigned, v_byes from _bassign;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'replace_slots', null,
        jsonb_build_object('positions', v_first, 'teams', v_assigned, 'byes', v_byes), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'assigned', v_assigned, 'byes', v_byes,
                              'cleared', v_first - v_assigned - v_byes);
end;
$$;

revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from public;
revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from anon;
grant  execute on function public.replace_bracket_slots(text,jsonb,integer) to authenticated;

create or replace function public.get_admin_bracket(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_b        public.hosted_tournament_brackets%rowtype;
    v_rounds   jsonb;
    v_slots    jsonb;
    v_entrants jsonb;
    v_matches  jsonb;
    v_drift    jsonb := '[]'::jsonb;
    v_stand    jsonb;
    v_qual     jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    select * into v_b from public.hosted_tournament_brackets where tournament_id = v_tid;
    if v_b.id is null then
        return jsonb_build_object('ok', true, 'bracket', null);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'roundNo', r.round_no, 'name', r.name, 'isFinalSlot', r.is_final_slot,
               'slotCount', (select count(*) from public.hosted_tournament_bracket_slots s
                              where s.round_id = r.id)) order by r.round_no), '[]'::jsonb)
      into v_rounds
      from public.hosted_tournament_bracket_rounds r where r.bracket_id = v_b.id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'roundNo', s.round_no, 'position', s.position,
               'slotType', s.slot_type, 'teamId', s.team_id,
               'teamNo', t.team_no, 'player1Name', t.player1_name, 'player2Name', t.player2_name,
               'teamStatus', t.status, 'feedsSlotId', s.feeds_slot_id)
               order by s.round_no, s.position), '[]'::jsonb)
      into v_slots
      from public.hosted_tournament_bracket_slots s
      left join public.hosted_tournament_teams t on t.id = s.team_id
     where s.bracket_id = v_b.id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'teamId', e.team_id, 'teamNo', t.team_no,
               'player1Name', t.player1_name, 'player2Name', t.player2_name,
               'teamStatus', t.status, 'source', e.source,
               'sourceGroupNo', e.source_group_no, 'sourceRank', e.source_rank,
               'seedNo', e.seed_no, 'note', e.snapshot_note,
               'placed', exists (select 1 from public.hosted_tournament_bracket_slots s
                                  where s.bracket_id = v_b.id and s.team_id = e.team_id))
               order by t.team_no), '[]'::jsonb)
      into v_entrants
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = v_b.id;

    -- ★ 4C 추가: 본선 경기 목록. 라운드 → destination 자리 순.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'matchNo', m.match_no, 'roundNo', m.round_no,
               'roundName', r.name,
               'targetRoundNo', ts.round_no, 'targetPosition', ts.position,
               'status', m.status, 'version', m.version,
               'courtNo', c.court_no, 'courtName', c.display_name,
               'score1', m.score1, 'score2', m.score2,
               'winnerTeamNo', wt.team_no,
               'team1', jsonb_build_object('teamNo', t1.team_no, 'player1Name', t1.player1_name,
                                           'player2Name', t1.player2_name, 'teamStatus', t1.status),
               'team2', jsonb_build_object('teamNo', t2.team_no, 'player1Name', t2.player1_name,
                                           'player2Name', t2.player2_name, 'teamStatus', t2.status))
               order by ts.round_no, ts.position), '[]'::jsonb)
      into v_matches
      from public.hosted_tournament_matches m
      join public.hosted_tournament_bracket_slots ts on ts.id = m.bracket_target_slot_id
      left join public.hosted_tournament_bracket_rounds r on r.bracket_id = v_b.id and r.round_no = m.round_no
      left join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      left join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_teams wt on wt.id = m.winner_team_id
      left join public.hosted_tournament_courts c on c.id = m.court_id
     where m.bracket_id = v_b.id and m.stage = 'knockout';

    -- 예선 결과와의 차이(표시 전용). standings 를 못 읽어도 화면은 떠야 하므로 실패를 삼킨다.
    --   ⚠ 여기서 읽은 값으로 entrants 를 만들거나 고치지 않는다.
    begin
        v_stand := public.get_preliminary_standings(p_slug);
        select coalesce(jsonb_agg(x.team_id), '[]'::jsonb) into v_qual
          from (select (st ->> 'teamId')::uuid as team_id
                  from jsonb_array_elements(coalesce(v_stand -> 'groups', '[]'::jsonb)) g,
                       jsonb_array_elements(coalesce(g -> 'standings', '[]'::jsonb)) st
                 where st ->> 'qualificationStatus' = 'QUALIFIED') x;

        select coalesce(jsonb_agg(jsonb_build_object('code', 'qualified_not_entrant',
                                                     'teamNo', t.team_no)), '[]'::jsonb)
          into v_drift
          from jsonb_array_elements_text(v_qual) as q(tid)
          join public.hosted_tournament_teams t on t.id = q.tid::uuid
         where not exists (select 1 from public.hosted_tournament_bracket_entrants e
                            where e.bracket_id = v_b.id and e.team_id = q.tid::uuid);

        v_drift := v_drift || coalesce((
            select jsonb_agg(jsonb_build_object('code', 'entrant_not_qualified', 'teamNo', t.team_no))
              from public.hosted_tournament_bracket_entrants e
              join public.hosted_tournament_teams t on t.id = e.team_id
             where e.bracket_id = v_b.id and e.source = 'group_rank'
               and not (v_qual @> to_jsonb(e.team_id::text))), '[]'::jsonb);
    exception when others then
        v_drift := '[]'::jsonb;
    end;

    return jsonb_build_object(
        'ok', true,
        'bracket', jsonb_build_object(
            'id', v_b.id, 'title', v_b.title, 'status', v_b.status, 'version', v_b.version,
            'declaredEntrantCount', v_b.declared_entrant_count,
            'lockedAt', v_b.locked_at, 'publishedAt', v_b.published_at, 'completedAt', v_b.completed_at),
        'rounds', v_rounds,
        'slots', v_slots,
        'entrants', v_entrants,
        'matches', v_matches,
        'entrantDrift', v_drift,
        'validation', public.hosted_tournament_bracket_validate(v_b.id));
end;
$$;

revoke execute on function public.get_admin_bracket(text) from public;
revoke execute on function public.get_admin_bracket(text) from anon;
grant  execute on function public.get_admin_bracket(text) to authenticated;

-- ── 3. 제약 · 인덱스 원복 (qualifier 데이터가 없을 때만) ───────────────────
do $idx$
declare
    v_q integer;
    v_check text;
begin
    select count(*) into v_q from public.hosted_tournament_bracket_slots
     where slot_type = 'qualifier' or source_kind is not null or resolved_at is not null;

    if v_q > 0 then
        raise notice 'qualifier 데이터가 %건 있어 제약 · 인덱스를 되돌리지 않는다(컬럼도 유지).', v_q;
    else
        drop index if exists public.hosted_tbslot_source_uniq;
        alter table public.hosted_tournament_bracket_slots
            drop constraint if exists hosted_tbslot_resolved_shape,
            drop constraint if exists hosted_tbslot_qualifier_round,
            drop constraint if exists hosted_tbslot_qualifier_shape,
            drop constraint if exists hosted_tbslot_source_kind_check;

        select c.conname into v_check
          from pg_constraint c
         where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass
           and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%slot_type%'
           and pg_get_constraintdef(c.oid) like '%qualifier%';
        if v_check is not null then
            execute format('alter table public.hosted_tournament_bracket_slots drop constraint %I', v_check);
            alter table public.hosted_tournament_bracket_slots
                add constraint hosted_tournament_bracket_slots_slot_type_check
                check (slot_type in ('team', 'bye', 'tbd'));
        end if;
    end if;
end $idx$;

-- ⚠ 라벨 helper 는 마지막에 지운다(위 함수들이 참조하지 않는 것을 확인한 뒤).
drop function if exists public.hosted_tournament_qualifier_label(integer, integer);

notify pgrst, 'reload schema';

commit;


-- =============================================================================
-- (선택) 컬럼까지 완전히 제거할 때만 — 경기이사가 입력한 본선 경로가 사라진다.
--   실행 전 확인:
--     select count(*) from public.hosted_tournament_bracket_slots where source_kind is not null;  -- 0 이어야 안전
--
--   begin;
--   alter table public.hosted_tournament_bracket_slots
--       drop column if exists resolved_at,
--       drop column if exists source_rank,
--       drop column if exists source_group_no,
--       drop column if exists source_kind;
--   notify pgrst, 'reload schema';
--   commit;
-- =============================================================================
