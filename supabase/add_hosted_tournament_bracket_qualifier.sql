-- =============================================================================
-- 2026 TEYEON OPEN — 본선 Qualifier Slot (Batch 4D-0)  (2026-09-29)
--
--   ★ TEYEON OPEN 기본 운영 모델
--       참가팀 수 확정 → 예선 조 수 확정 → 본선 구조 작성
--       → 경기이사가 Qualifier Map 작성('1조 1위' vs '16조 2위')
--       → 본선 경로 확정(lock) → 이 경로를 참고해 예선 조 편성
--       → 예선 진행 → 공식 순위 확정 → 예선 결과 반영(resolve) → materialize
--     즉 '예선 결과를 보고 본선을 짜는' 것이 아니라
--        '본선 경로를 먼저 정하고 그 경로를 참고해 예선 조를 편성'한다.
--
--   ★ 시스템이 결정하지 않는 것(4A~4C 와 동일)
--     · 어느 조 몇 위가 어느 자리로 가는지 · 시드 · BYE 위치 · 조합 · 라운드 수
--     이 파일은 저장 · 검증 · 표시 · (공식 순위 확정 후) resolve 만 담당한다.
--
--   ★ 두 행위를 끝까지 분리한다
--       lock_bracket              = 본선 경로 확정 (사람이 자리를 못 바꾸게 얼린다)
--       resolve_bracket_qualifiers = 예선 결과 반영 (자리에 실제 팀을 채운다)
--     lock 이 resolve 를 하지 않고, resolve 가 lock 을 풀지 않는다.
--
--   이번 Batch 가 하는 일
--     1. slots 에 source_kind / source_group_no / source_rank / resolved_at 추가
--     2. slot_type 에 'qualifier' 추가 ('tbd' 와 의미를 분리)
--          qualifier = 예선 결과 대기 / tbd = 이전 본선 경기 승자 대기
--     3. validate 확장 — qualifier 허용 + 조 · 순위 정합성 검사
--     4. assign_bracket_slot(7인자 신규) · replace_bracket_slots 가 qualifier 수용
--        ⚠ 기존 5인자 assign_bracket_slot 은 그대로 남겨 위임한다(프런트 무중단)
--     5. resolve_bracket_qualifiers / unresolve_bracket_qualifier 신규
--     6. get_admin_bracket 에 qualifier 필드 + 정정 감지(qualifierDrift) 추가
--
--   ⚠ 4C 엔진(materialize · complete_knockout_match · amend_knockout_match_score ·
--     create_match · advance · guard 3종)은 **한 줄도 바꾸지 않는다.**
--     근거: 경기 생성은 feeder 둘 다 slot_type='team' 일 때만, 부전승 전달은
--     sibling 이 'bye' 일 때만 일어난다 → 'qualifier' 자리는 구조적으로 제외된다.
--
--   ⚠ additive 전용
--     · 테이블 · FK 를 만들지 않는다. 컬럼 4개는 전부 nullable(기존 행 backfill 0).
--     · 기존 행을 UPDATE / DELETE 하지 않는다.
--     · 예선 · 경기 엔진 · 공개 RPC 를 건드리지 않는다.
--
--   ⚠ 잠금 순서 (전역 규칙 유지)
--       hosted-tournament-matches:<tid>   →   hosted-tournament-bracket:<tid>
--     resolve 는 matches 를 건드리지 않으므로 bracket 만 잡는다.
--     unresolve 는 대기 경기를 지울 수 있으므로 matches → bracket 순서로 잡는다.
--
--   검증  : add_hosted_tournament_bracket_qualifier_verify.sql
--   실동작: verify_hosted_tournament_bracket_qualifier_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_bracket_qualifier_rollback.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
declare
    v_check text;
begin
    if to_regclass('public.hosted_tournament_bracket_slots') is null then
        raise exception '본선 Bracket 기반(Batch 4A)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.materialize_bracket_matches(text,integer)') is null
       or to_regprocedure('public.complete_knockout_match(uuid,integer,integer,integer)') is null then
        raise exception '본선 Match Engine(Batch 4C)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_preliminary_standings_core(uuid)') is null then
        raise exception '예선 순위 계산 코어(public draw)가 없습니다. resolve 가 불가능합니다.';
    end if;

    -- slot_type CHECK 은 인라인 정의라 이름이 자동 생성이다. 이름을 추정해서 지우지 않는다.
    select c.conname into v_check
      from pg_constraint c
     where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%slot_type%'
       and pg_get_constraintdef(c.oid) like '%tbd%';
    if v_check is null then
        raise exception 'slot_type CHECK 을 찾지 못했습니다. 적용 상태를 먼저 확인하세요.';
    end if;
end $guard$;


-- ── 1. 컬럼 4개 (nullable · backfill 없음) ───────────────────────────────────
alter table public.hosted_tournament_bracket_slots
    add column if not exists source_kind     text,
    add column if not exists source_group_no integer,
    add column if not exists source_rank     integer,
    add column if not exists resolved_at     timestamptz;

comment on column public.hosted_tournament_bracket_slots.source_kind is
    'group_rank = 예선 순위 자리(N조 M위) / manual = 경기이사 직접 배치 / bye = 부전승. '
    '⚠ resolve 된 뒤에도 지우지 않는다 — "1조 1위 · 홍OO·김OO" 표시의 근거다.';
comment on column public.hosted_tournament_bracket_slots.resolved_at is
    '예선 결과 반영 시각. NULL 이면 아직 실제 팀이 정해지지 않았다.';


-- ── 2. 제약 · 인덱스 ─────────────────────────────────────────────────────────
do $cons$
declare
    v_check text;
begin
    -- slot_type 값 목록 교체 (team | bye | tbd | qualifier)
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.hosted_tournament_bracket_slots'::regclass
                      and contype = 'c' and pg_get_constraintdef(oid) like '%qualifier%'
                      and pg_get_constraintdef(oid) like '%slot_type%') then
        select c.conname into v_check
          from pg_constraint c
         where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass
           and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%slot_type%'
           and pg_get_constraintdef(c.oid) like '%tbd%';
        if v_check is not null then
            execute format('alter table public.hosted_tournament_bracket_slots drop constraint %I', v_check);
        end if;
        alter table public.hosted_tournament_bracket_slots
            add constraint hosted_tbslot_type_check
            check (slot_type in ('team', 'bye', 'tbd', 'qualifier'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'hosted_tbslot_source_kind_check') then
        alter table public.hosted_tournament_bracket_slots
            add constraint hosted_tbslot_source_kind_check
            check (source_kind is null or source_kind in ('group_rank', 'manual', 'bye'));
    end if;

    -- qualifier ⇒ 팀이 없고, 조 · 순위가 반드시 있다.
    if not exists (select 1 from pg_constraint where conname = 'hosted_tbslot_qualifier_shape') then
        alter table public.hosted_tournament_bracket_slots
            add constraint hosted_tbslot_qualifier_shape
            check (slot_type <> 'qualifier'
                   or (team_id is null and source_kind = 'group_rank'
                       and source_group_no >= 1 and source_rank >= 1));
    end if;

    -- qualifier 는 1라운드에만(BYE 와 같은 정책 — 2라운드 이후는 승자 대기다).
    if not exists (select 1 from pg_constraint where conname = 'hosted_tbslot_qualifier_round') then
        alter table public.hosted_tournament_bracket_slots
            add constraint hosted_tbslot_qualifier_round
            check (slot_type <> 'qualifier' or round_no = 1);
    end if;

    -- resolved_at 은 '예선 순위 자리가 실제 팀으로 확정된' 상태에서만 존재한다.
    if not exists (select 1 from pg_constraint where conname = 'hosted_tbslot_resolved_shape') then
        alter table public.hosted_tournament_bracket_slots
            add constraint hosted_tbslot_resolved_shape
            check (resolved_at is null
                   or (slot_type = 'team' and source_kind = 'group_rank' and team_id is not null));
    end if;
end $cons$;

-- 같은 'N조 M위' 를 두 자리에 놓을 수 없다(최종 방어선).
create unique index if not exists hosted_tbslot_source_uniq
    on public.hosted_tournament_bracket_slots (bracket_id, source_group_no, source_rank)
 where source_kind = 'group_rank';


-- ── 3. 내부 helper: 표시 라벨 ────────────────────────────────────────────────
--   ⚠ 라벨은 서버가 만든다. 프런트가 '조'/'위' 를 조합하지 않는다(표기 통일).
create or replace function public.hosted_tournament_qualifier_label(
    p_group_no integer,
    p_rank     integer
)
returns text
language sql
immutable
as $$
    select case when p_group_no is null or p_rank is null then null
                else p_group_no || '조 ' || p_rank || '위' end;
$$;

revoke execute on function public.hosted_tournament_qualifier_label(integer,integer) from public;
revoke execute on function public.hosted_tournament_qualifier_label(integer,integer) from anon;
revoke execute on function public.hosted_tournament_qualifier_label(integer,integer) from authenticated;


-- ── 4. 내부 helper: 하위 경기 상태 판정 ──────────────────────────────────────
--   그 자리가 feeder 인 destination 에 본선 경기가 있는지, 있다면 어떤 상태인지.
--   ⚠ 4C amend 의 하위 보호와 **같은 규약**이다(새 기준을 만들지 않는다).
create or replace function public.hosted_tournament_qualifier_downstream(
    p_bracket_id uuid,
    p_slot_id    uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_feeds uuid;
    v_id    uuid;
    v_st    text;
    v_no    integer;
begin
    select feeds_slot_id into v_feeds
      from public.hosted_tournament_bracket_slots where id = p_slot_id;
    if v_feeds is null then
        return jsonb_build_object('state', 'none');
    end if;

    select id, status, match_no into v_id, v_st, v_no
      from public.hosted_tournament_matches
     where bracket_id = p_bracket_id and bracket_target_slot_id = v_feeds
       and stage = 'knockout';

    if v_id is null then
        return jsonb_build_object('state', 'none');
    end if;
    return jsonb_build_object('state', v_st, 'matchId', v_id, 'matchNo', v_no);
end;
$$;

revoke execute on function public.hosted_tournament_qualifier_downstream(uuid,uuid) from public;
revoke execute on function public.hosted_tournament_qualifier_downstream(uuid,uuid) from anon;
revoke execute on function public.hosted_tournament_qualifier_downstream(uuid,uuid) from authenticated;


-- ── 5. 구조 검증 교체 (qualifier 규칙 추가) ──────────────────────────────────
--   변경점은 4곳뿐이다.
--     · no_entrants 완화 — qualifier 자리가 있으면 진출팀 0 이어도 error 가 아니다.
--     · qualifier_group_missing        (조편성 locked 면 error / 아니면 warning)
--     · qualifier_rank_out_of_range    (조편성 locked 면 error / 아니면 warning)
--     · qualifier_rank_beyond_qualify  (항상 warning — 와일드카드 저장은 막지 않는다)
--   나머지 규칙(구조 · BYE · 연결 · 진출팀)은 4A 그대로다.
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
    -- 4D-0
    v_qualifiers integer;
    v_resolved   integer;
    v_draw       text;
    v_sev        text;
    v_core       jsonb;
    v_qualify    integer;
begin
    select * into v_b from public.hosted_tournament_brackets where id = p_bracket_id;
    if v_b.id is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_found');
    end if;

    select count(*) into v_entrants from public.hosted_tournament_bracket_entrants where bracket_id = p_bracket_id;
    select count(*) into v_rounds   from public.hosted_tournament_bracket_rounds   where bracket_id = p_bracket_id;
    select count(*) into v_slots    from public.hosted_tournament_bracket_slots    where bracket_id = p_bracket_id;

    select count(*) filter (where slot_type = 'qualifier'),
           count(*) filter (where resolved_at is not null)
      into v_qualifiers, v_resolved
      from public.hosted_tournament_bracket_slots where bracket_id = p_bracket_id;

    -- ★ 4D-0: qualifier 자리로 경로를 먼저 짜는 운영에서는 진출팀이 아직 없다.
    if v_entrants = 0 and v_qualifiers = 0 then
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

        if v_max_round <> v_rounds then
            v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                'code', 'round_gap', 'severity', 'error', 'maxRoundNo', v_max_round, 'roundCount', v_rounds));
        end if;

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

    select coalesce(jsonb_agg(jsonb_build_object('code', 'round_no_mismatch', 'severity', 'error',
                                                 'slotId', s.id, 'slotRoundNo', s.round_no, 'roundNo', r.round_no)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and s.round_no <> r.round_no;
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'missing_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and not r.is_final_slot and s.feeds_slot_id is null;
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'final_slot_has_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and r.is_final_slot and s.feeds_slot_id is not null;
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'feed_other_bracket', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_slots f on f.id = s.feeds_slot_id
     where s.bracket_id = p_bracket_id and f.bracket_id <> s.bracket_id;
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'feed_not_next_round', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position,
                                                 'feedsRoundNo', f.round_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_slots f on f.id = s.feeds_slot_id
     where s.bracket_id = p_bracket_id and f.round_no <> s.round_no + 1;
    v_issues := v_issues || v_tmp;

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

    select coalesce(jsonb_agg(jsonb_build_object('code', 'bye_outside_first_round', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.slot_type = 'bye' and s.round_no > 1;
    v_issues := v_issues || v_tmp;

    -- 1라운드에 미배치(tbd) 남음 → 운영 시작 불가. ⚠ qualifier 는 '배치된' 것이다.
    select coalesce(jsonb_agg(jsonb_build_object('code', 'unassigned_first_round_slot', 'severity', 'error',
                                                 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no = 1 and s.slot_type = 'tbd';
    v_issues := v_issues || v_tmp;

    -- 2라운드 이상은 전부 승자 대기(tbd)여야 한다(qualifier 도 올 수 없다).
    select coalesce(jsonb_agg(jsonb_build_object('code', 'non_tbd_future_slot', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position,
                                                 'slotType', s.slot_type)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no > 1 and s.slot_type <> 'tbd';
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'slot_team_not_entrant', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.team_id is not null
       and not exists (select 1 from public.hosted_tournament_bracket_entrants e
                        where e.bracket_id = p_bracket_id and e.team_id = s.team_id);
    v_issues := v_issues || v_tmp;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'entrant_not_placed', 'severity', 'error',
                                                 'teamNo', t.team_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = p_bracket_id
       and not exists (select 1 from public.hosted_tournament_bracket_slots s
                        where s.bracket_id = p_bracket_id and s.team_id = e.team_id);
    v_issues := v_issues || v_tmp;

    -- ── ★ 4D-0: qualifier 자리 검사 ──────────────────────────────────────
    if v_qualifiers > 0 or v_resolved > 0 then
        select preliminary_draw_status into v_draw
          from public.hosted_tournaments where id = v_b.tournament_id;
        -- 조편성이 확정되기 전에는 '아직 없는 조'를 가리켜도 정상이다(경로를 먼저 짜므로).
        v_sev := case when v_draw = 'locked' then 'error' else 'warning' end;

        select coalesce(jsonb_agg(jsonb_build_object(
                   'code', 'qualifier_group_missing', 'severity', v_sev,
                   'position', s.position, 'groupNo', s.source_group_no, 'rank', s.source_rank)), '[]'::jsonb)
          into v_tmp
          from public.hosted_tournament_bracket_slots s
         where s.bracket_id = p_bracket_id and s.source_kind = 'group_rank'
           and not exists (select 1 from public.hosted_tournament_groups g
                            where g.tournament_id = v_b.tournament_id
                              and g.group_no = s.source_group_no
                              and g.group_type = 'preliminary');
        v_issues := v_issues || v_tmp;

        select coalesce(jsonb_agg(jsonb_build_object(
                   'code', 'qualifier_rank_out_of_range', 'severity', v_sev,
                   'position', s.position, 'groupNo', s.source_group_no, 'rank', s.source_rank,
                   'groupSize', g.expected_size)), '[]'::jsonb)
          into v_tmp
          from public.hosted_tournament_bracket_slots s
          join public.hosted_tournament_groups g
            on g.tournament_id = v_b.tournament_id and g.group_no = s.source_group_no
           and g.group_type = 'preliminary'
         where s.bracket_id = p_bracket_id and s.source_kind = 'group_rank'
           and s.source_rank > g.expected_size;
        v_issues := v_issues || v_tmp;

        -- 진출 인원을 넘는 순위(예: 조 3위)도 저장은 되지만 경고로 알린다.
        --   ⚠ 상수를 여기에 다시 적지 않는다 — 예선 계산 코어가 알려준 값만 쓴다.
        begin
            v_core := public.hosted_tournament_preliminary_standings_core(v_b.tournament_id);
            v_qualify := (v_core ->> 'qualifyPerGroup')::integer;
        exception when others then
            v_qualify := null;
        end;
        if v_qualify is not null then
            select coalesce(jsonb_agg(jsonb_build_object(
                       'code', 'qualifier_rank_beyond_qualify', 'severity', 'warning',
                       'position', s.position, 'groupNo', s.source_group_no, 'rank', s.source_rank,
                       'qualifyPerGroup', v_qualify)), '[]'::jsonb)
              into v_tmp
              from public.hosted_tournament_bracket_slots s
             where s.bracket_id = p_bracket_id and s.source_kind = 'group_rank'
               and s.source_rank > v_qualify;
            v_issues := v_issues || v_tmp;
        end if;
    end if;

    -- ── warning (4A 그대로) ──────────────────────────────────────────────
    -- ⚠ qualifier 운영에서는 '아직 반영되지 않은 자리'도 진출 예정 인원으로 센다.
    --   (예선 전에는 entrants 가 0이라 declared 와 항상 어긋나 경고가 소음이 된다)
    if v_b.declared_entrant_count is not null
       and v_b.declared_entrant_count <> v_entrants + v_qualifiers then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'declared_count_mismatch', 'severity', 'warning',
            'declared', v_b.declared_entrant_count,
            'actual', v_entrants + v_qualifiers));
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

    select count(*) into v_matches from (
        select f.feeds_slot_id
          from public.hosted_tournament_bracket_slots f
         where f.bracket_id = p_bracket_id and f.feeds_slot_id is not null and f.slot_type = 'team'
         group by f.feeds_slot_id having count(*) = 2) d;

    select count(*) into v_bye_adv
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.slot_type = 'bye' and s.feeds_slot_id is not null;

    return jsonb_build_object(
        'ok', not exists (select 1 from jsonb_array_elements(v_issues) i
                           where i ->> 'severity' = 'error'),
        'issues', v_issues,
        'summary', jsonb_build_object(
            'entrants', v_entrants, 'rounds', v_rounds, 'slots', v_slots,
            'firstRoundSlots', v_first, 'byes', v_byes, 'unassigned', v_unassigned,
            'matchesToCreate', v_matches, 'byeAdvances', v_bye_adv,
            'qualifiers', v_qualifiers, 'resolved', v_resolved));
end;
$$;

revoke execute on function public.hosted_tournament_bracket_validate(uuid) from public;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from anon;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from authenticated;


-- ── 6. 자리 1개 배치 (qualifier 수용) ────────────────────────────────────────
--   ⚠ 신규 7인자. 기존 5인자는 아래에서 그대로 유지해 위임한다(프런트 무중단).
create or replace function public.assign_bracket_slot(
    p_slug             text,
    p_slot_id          uuid,
    p_slot_type        text,
    p_team_id          uuid,
    p_source_group_no  integer,
    p_source_rank      integer,
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
    v_kind    text;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_slot_type not in ('team', 'bye', 'tbd', 'qualifier') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_slot_type');
    end if;
    if (p_slot_type = 'team') <> (p_team_id is not null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if p_slot_type = 'qualifier'
       and (p_source_group_no is null or p_source_rank is null
            or p_source_group_no < 1 or p_source_rank < 1) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_qualifier');
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

    if p_slot_type = 'qualifier'
       and exists (select 1 from public.hosted_tournament_bracket_slots
                    where bracket_id = v_bid and source_kind = 'group_rank'
                      and source_group_no = p_source_group_no and source_rank = p_source_rank
                      and id <> p_slot_id) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_qualifier',
                                  'label', public.hosted_tournament_qualifier_label(p_source_group_no, p_source_rank));
    end if;

    v_kind := case p_slot_type when 'qualifier' then 'group_rank'
                               when 'team'      then 'manual'
                               when 'bye'       then 'bye'
                               else null end;

    v_before := jsonb_build_object('slotType', v_s.slot_type, 'teamId', v_s.team_id,
                                   'sourceKind', v_s.source_kind,
                                   'sourceGroupNo', v_s.source_group_no, 'sourceRank', v_s.source_rank);

    update public.hosted_tournament_bracket_slots
       set slot_type       = p_slot_type,
           team_id         = case when p_slot_type = 'team' then p_team_id else null end,
           entrant_id      = case when p_slot_type = 'team' then v_eid else null end,
           source_kind     = v_kind,
           source_group_no = case when p_slot_type = 'qualifier' then p_source_group_no end,
           source_rank     = case when p_slot_type = 'qualifier' then p_source_rank end,
           resolved_at     = null,
           updated_at      = now()
     where id = p_slot_id;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket_slot', p_slot_id, 'assign_slot', v_before,
        jsonb_build_object('slotType', p_slot_type, 'teamId', p_team_id,
                           'position', v_s.position, 'sourceKind', v_kind,
                           'sourceGroupNo', p_source_group_no, 'sourceRank', p_source_rank,
                           'label', public.hosted_tournament_qualifier_label(p_source_group_no, p_source_rank)), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'slot', jsonb_build_object('id', p_slot_id, 'roundNo', v_s.round_no,
                                                         'position', v_s.position, 'slotType', p_slot_type,
                                                         'label', public.hosted_tournament_qualifier_label(p_source_group_no, p_source_rank)));
end;
$$;

revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer,integer,integer) from public;
revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer,integer,integer) from anon;
grant  execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer,integer,integer) to authenticated;


-- ── 6-1. 기존 5인자 호환 래퍼 (⚠ 제거하지 않는다) ────────────────────────────
--   4D-0 DB 적용과 4D-1 프런트 배포 사이에도 기존 STEP 3 자리 편집이 그대로 동작해야 한다.
--   4D-1 운영 반영이 끝난 뒤 별도 cleanup 에서 제거한다.
create or replace function public.assign_bracket_slot(
    p_slug             text,
    p_slot_id          uuid,
    p_slot_type        text,
    p_team_id          uuid,
    p_expected_version integer
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
    select public.assign_bracket_slot(p_slug, p_slot_id, p_slot_type, p_team_id,
                                      null::integer, null::integer, p_expected_version);
$$;

revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from public;
revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from anon;
grant  execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) to authenticated;


-- ── 7. 1라운드 전량 교체 (qualifier 수용) ────────────────────────────────────
--   ⚠ 1라운드 '모든' 자리를 한 번에 보낸다. 부분 반영 없음 — 전량 검증 후 전량 반영.
--   ⚠ BYE · qualifier 위치는 payload 그대로 저장한다(자동 배치 · 자동 추론 없음).
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
    v_gno     integer;
    v_rank    integer;
    v_first   integer;
    v_assigned integer;
    v_byes    integer;
    v_quals   integer;
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
    create temp table _bassign (position integer, slot_type text, team_id uuid,
                                source_kind text, group_no integer, rank_no integer) on commit drop;

    for v_a in select * from jsonb_array_elements(p_assignments) loop
        v_pos  := nullif(v_a ->> 'position', '')::integer;
        v_type := coalesce(v_a ->> 'type', '');
        v_team := nullif(v_a ->> 'teamId', '')::uuid;
        v_gno  := nullif(v_a ->> 'groupNo', '')::integer;
        v_rank := nullif(v_a ->> 'rank', '')::integer;

        if v_pos is null or v_type not in ('team', 'bye', 'tbd', 'qualifier') then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
        end if;
        if (v_type = 'team') <> (v_team is not null) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'position', v_pos);
        end if;
        if v_type = 'qualifier' and (v_gno is null or v_rank is null or v_gno < 1 or v_rank < 1) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_qualifier', 'position', v_pos);
        end if;
        if exists (select 1 from _bassign where position = v_pos) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_position', 'position', v_pos);
        end if;
        if v_team is not null and exists (select 1 from _bassign where team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_team', 'teamId', v_team);
        end if;
        if v_type = 'qualifier' and exists (select 1 from _bassign
                                             where group_no = v_gno and rank_no = v_rank) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_qualifier', 'position', v_pos,
                                      'label', public.hosted_tournament_qualifier_label(v_gno, v_rank));
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

        insert into _bassign values (v_pos, v_type, v_team,
            case v_type when 'qualifier' then 'group_rank'
                        when 'team' then 'manual'
                        when 'bye'  then 'bye' else null end,
            case when v_type = 'qualifier' then v_gno end,
            case when v_type = 'qualifier' then v_rank end);
    end loop;

    -- 전량 반영
    update public.hosted_tournament_bracket_slots s
       set slot_type       = a.slot_type,
           team_id         = a.team_id,
           entrant_id      = e.id,
           source_kind     = a.source_kind,
           source_group_no = a.group_no,
           source_rank     = a.rank_no,
           resolved_at     = null,
           updated_at      = now()
      from _bassign a
      left join public.hosted_tournament_bracket_entrants e
        on e.bracket_id = v_bid and e.team_id = a.team_id
     where s.bracket_id = v_bid and s.round_no = 1 and s.position = a.position;

    select count(*) filter (where slot_type = 'team'),
           count(*) filter (where slot_type = 'bye'),
           count(*) filter (where slot_type = 'qualifier')
      into v_assigned, v_byes, v_quals from _bassign;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'replace_slots', null,
        jsonb_build_object('positions', v_first, 'teams', v_assigned, 'byes', v_byes,
                           'qualifiers', v_quals), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'assigned', v_assigned, 'byes', v_byes, 'qualifiers', v_quals,
                              'cleared', v_first - v_assigned - v_byes - v_quals);
end;
$$;

revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from public;
revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from anon;
grant  execute on function public.replace_bracket_slots(text,jsonb,integer) to authenticated;


-- ── 8. RPC: 예선 결과 반영 (qualifier → 실제 팀) ─────────────────────────────
--   ⚠ 자동 실행 금지. 경기이사가 결과를 확인하고 직접 누를 때만 실행된다.
--   ⚠ 공식적으로 순위가 확정된 조만 반영한다.
--       조 경기 전부 완료 + 미해결 동률 없음 + 취소 경기 없음 + 그 순위의 rank 가 확정.
--     합산연령 확인이 필요한 조는 여기서 통과하지 못한다(보류로 남는다).
--   ⚠ 부분 반영을 허용한다 — 조마다 끝나는 시점이 다르다.
--   ⚠ 경기를 만들지 않는다(materialize 의 몫). 잠금은 bracket 만 잡는다.
create or replace function public.resolve_bracket_qualifiers(
    p_slug             text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin    jsonb;
    v_tid      uuid;
    v_bid      uuid;
    v_version  integer;
    v_core     jsonb;
    v_s        record;
    v_grp      jsonb;
    v_row      jsonb;
    v_team     uuid;
    v_eid      uuid;
    v_resolved jsonb := '[]'::jsonb;
    v_skipped  jsonb := '[]'::jsonb;
    v_reason   text;
    v_cnt      integer := 0;
    v_label    text;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;

    -- ★ 본선 경로가 확정된 뒤에만 예선 결과를 반영한다.
    if v_begin ->> 'status' = 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_locked');
    end if;
    if v_begin ->> 'status' = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
    end if;

    -- 운영 · 공개 화면과 같은 계산 코어. 여기서 순위를 새로 계산하지 않는다.
    v_core := public.hosted_tournament_preliminary_standings_core(v_tid);

    for v_s in
        select s.id, s.position, s.source_group_no, s.source_rank
          from public.hosted_tournament_bracket_slots s
         where s.bracket_id = v_bid and s.slot_type = 'qualifier'
         order by s.position
    loop
        v_label  := public.hosted_tournament_qualifier_label(v_s.source_group_no, v_s.source_rank);
        v_reason := null;
        v_team   := null;

        select g into v_grp
          from jsonb_array_elements(coalesce(v_core -> 'groups', '[]'::jsonb)) g
         where (g ->> 'groupNo')::integer = v_s.source_group_no
         limit 1;

        if v_grp is null then
            v_reason := 'group_not_found';
        elsif v_grp ->> 'policyRequired' is not null then
            -- 취소 경기가 남아 있으면 운영 판단이 먼저다(순위 상태보다 이 사유를 먼저 알린다).
            v_reason := 'cancelled_present';
        elsif v_grp ->> 'rankingStatus' <> 'FINAL' then
            -- 조 미완료(PROVISIONAL) · 미해결 동률(AGE_CHECK_REQUIRED) 모두 보류다.
            v_reason := case when v_grp ->> 'rankingStatus' = 'AGE_CHECK_REQUIRED'
                             then 'tie_unresolved' else 'rank_not_final' end;
        else
            select st into v_row
              from jsonb_array_elements(coalesce(v_grp -> 'standings', '[]'::jsonb)) st
             where (st -> 'rank') is not null
               and (st ->> 'rank')::integer = v_s.source_rank
             limit 1;

            if v_row is null then
                v_reason := 'rank_out_of_range';
            elsif v_row ->> 'qualificationStatus' = 'PENDING' then
                v_reason := 'rank_not_final';
            else
                v_team := (v_row ->> 'teamId')::uuid;
                if exists (select 1 from public.hosted_tournament_bracket_slots
                            where bracket_id = v_bid and team_id = v_team) then
                    v_reason := 'team_already_placed';
                    v_team   := null;
                end if;
            end if;
        end if;

        if v_team is null then
            v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
                'position', v_s.position, 'label', v_label, 'reason', coalesce(v_reason, 'unknown')));
            continue;
        end if;

        -- 진출팀 스냅샷도 함께 남긴다 → 4A 의 slot_team_not_entrant 불변식 유지.
        select id into v_eid from public.hosted_tournament_bracket_entrants
         where bracket_id = v_bid and team_id = v_team;
        if v_eid is null then
            insert into public.hosted_tournament_bracket_entrants
                (tournament_id, bracket_id, team_id, source, source_group_no, source_rank)
            values (v_tid, v_bid, v_team, 'group_rank', v_s.source_group_no, v_s.source_rank)
            returning id into v_eid;
        end if;

        update public.hosted_tournament_bracket_slots
           set slot_type   = 'team',
               team_id     = v_team,
               entrant_id  = v_eid,
               resolved_at = now(),
               updated_at  = now()
         where id = v_s.id;
        -- ⚠ source_kind / source_group_no / source_rank 는 보존한다.

        v_cnt := v_cnt + 1;
        v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
            'position', v_s.position, 'label', v_label,
            'teamNo', (select team_no from public.hosted_tournament_teams where id = v_team)));

        perform public.hosted_tournament_log_event(
            v_tid, 'bracket_slot', v_s.id, 'resolve_qualifier',
            jsonb_build_object('slotType', 'qualifier', 'label', v_label),
            jsonb_build_object('slotType', 'team', 'position', v_s.position,
                               'teamNo', (select team_no from public.hosted_tournament_teams where id = v_team)),
            null);
    end loop;

    if v_cnt > 0 then
        v_version := public.hosted_tournament_bracket_bump(v_bid);
        perform public.hosted_tournament_log_event(
            v_tid, 'bracket', v_bid, 'resolve_qualifiers', null,
            jsonb_build_object('resolved', v_cnt,
                               'skipped', jsonb_array_length(v_skipped), 'version', v_version), null);
    else
        v_version := (v_begin ->> 'version')::integer;
    end if;

    return jsonb_build_object('ok', true, 'version', v_version,
                              'resolved', v_resolved, 'skipped', v_skipped,
                              'resolvedCount', v_cnt, 'skippedCount', jsonb_array_length(v_skipped));
end;
$$;

revoke execute on function public.resolve_bracket_qualifiers(text,integer) from public;
revoke execute on function public.resolve_bracket_qualifiers(text,integer) from anon;
grant  execute on function public.resolve_bracket_qualifiers(text,integer) to authenticated;


-- ── 9. RPC: 반영 되돌리기 (실제 팀 → qualifier) ──────────────────────────────
--   예선 순위가 정정된 경우에만 쓴다. 사유 필수.
--   ⚠ 하위 경기 보호는 4C amend 와 같은 규약이다.
--       경기 없음      → 허용
--       WAITING        → 그 대기 경기를 삭제하고 기록을 남긴다(점수 · 코트가 없는 행)
--       CALLING/PLAYING/COMPLETED → 거부
--   ⚠ 조용한 삭제 금지 — 삭제 전후를 이벤트로 남긴다.
--   ⚠ 잠금 순서: matches → bracket.
create or replace function public.unresolve_bracket_qualifier(
    p_slug             text,
    p_position         integer,
    p_reason           text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_begin    jsonb;
    v_bid      uuid;
    v_version  integer;
    v_reason   text;
    v_s        public.hosted_tournament_bracket_slots%rowtype;
    v_down     jsonb;
    v_state    text;
    v_mid      uuid;
    v_mno      integer;
    v_team     uuid;
    v_teamno   integer;
    v_label    text;
    v_removed  integer := 0;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    -- ★ 전역 잠금 순서: matches → bracket.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
    end if;

    select * into v_s from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid and round_no = 1 and position = p_position;
    if v_s.id is null then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_s.resolved_at is null or v_s.source_kind <> 'group_rank' or v_s.slot_type <> 'team' then
        return jsonb_build_object('ok', false, 'reason', 'not_resolved_qualifier');
    end if;

    v_team  := v_s.team_id;
    v_label := public.hosted_tournament_qualifier_label(v_s.source_group_no, v_s.source_rank);
    select team_no into v_teamno from public.hosted_tournament_teams where id = v_team;

    v_down  := public.hosted_tournament_qualifier_downstream(v_bid, v_s.id);
    v_state := v_down ->> 'state';

    if v_state in ('calling', 'playing', 'completed') then
        return jsonb_build_object('ok', false, 'reason', 'downstream_' || v_state,
                                  'matchNo', (v_down ->> 'matchNo')::integer);
    end if;
    if v_state not in ('none', 'waiting') then
        return jsonb_build_object('ok', false, 'reason', 'downstream_' || coalesce(v_state, 'unknown'));
    end if;

    -- 대기 경기 삭제 — 한쪽 자리가 비면 경기가 성립하지 않는다.
    --   ⚠ 이 bracket 의 knockout · WAITING 경기만. 예선 · 다른 경기에는 손대지 않는다.
    if v_state = 'waiting' then
        v_mid := (v_down ->> 'matchId')::uuid;
        v_mno := (v_down ->> 'matchNo')::integer;

        perform public.hosted_tournament_log_event(
            v_tid, 'match', v_mid, 'knockout_match_removed',
            jsonb_build_object('matchNo', v_mno, 'status', 'waiting'),
            jsonb_build_object('cause', 'unresolve_qualifier', 'position', p_position,
                               'label', v_label), v_reason);

        delete from public.hosted_tournament_matches
         where id = v_mid and bracket_id = v_bid and stage = 'knockout' and status = 'waiting';
        get diagnostics v_removed = row_count;

        if v_removed = 0 then
            -- 잠금 사이에 상태가 바뀌었다는 뜻이다. 아무것도 바꾸지 않고 물러난다.
            return jsonb_build_object('ok', false, 'reason', 'already_changed');
        end if;
    end if;

    update public.hosted_tournament_bracket_slots
       set slot_type   = 'qualifier',
           team_id     = null,
           entrant_id  = null,
           resolved_at = null,
           updated_at  = now()
     where id = v_s.id;
    -- ⚠ source_kind / source_group_no / source_rank 는 그대로 둔다(자리의 의미는 유지).

    -- 이 팀이 다른 자리에 없으면 진출팀 스냅샷에서도 뺀다.
    delete from public.hosted_tournament_bracket_entrants e
     where e.bracket_id = v_bid and e.team_id = v_team
       and not exists (select 1 from public.hosted_tournament_bracket_slots s
                        where s.bracket_id = v_bid and s.team_id = v_team);

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket_slot', v_s.id, 'unresolve_qualifier',
        jsonb_build_object('slotType', 'team', 'teamNo', v_teamno, 'position', p_position),
        jsonb_build_object('slotType', 'qualifier', 'label', v_label,
                           'removedMatchNo', v_mno), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'label', v_label,
                              'removedMatchNo', v_mno, 'removedMatches', v_removed);
end;
$$;

revoke execute on function public.unresolve_bracket_qualifier(text,integer,text,integer) from public;
revoke execute on function public.unresolve_bracket_qualifier(text,integer,text,integer) from anon;
grant  execute on function public.unresolve_bracket_qualifier(text,integer,text,integer) to authenticated;


-- ── 10. get_admin_bracket — qualifier 필드 + 정정 감지 추가 ──────────────────
--   ⚠ 4C 반환값을 하나도 제거하지 않는다. slots 필드와 qualifierDrift 키만 추가한다.
--   ⚠ 반환 화이트리스트 유지 — registrations 를 join 하지 않는다.
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
    v_qdrift   jsonb := '[]'::jsonb;
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
               'teamStatus', t.status, 'feedsSlotId', s.feeds_slot_id,
               -- ★ 4D-0
               'sourceKind', s.source_kind,
               'sourceGroupNo', s.source_group_no,
               'sourceRank', s.source_rank,
               'sourceLabel', public.hosted_tournament_qualifier_label(s.source_group_no, s.source_rank),
               'resolvedAt', s.resolved_at)
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
    --   ⚠ 여기서 읽은 값으로 entrants 나 자리를 고치지 않는다.
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

        -- ★ 4D-0: 이미 반영한 자리가 현재 예선 순위와 다른가(순위 정정 감지).
        --   ⚠ 자동으로 되돌리지 않는다. 운영자가 보고 판단한다.
        select coalesce(jsonb_agg(jsonb_build_object(
                   'code', 'qualifier_resolution_stale',
                   'position', s.position,
                   'label', public.hosted_tournament_qualifier_label(s.source_group_no, s.source_rank),
                   'resolvedTeamNo', t.team_no,
                   'currentTeamNo', cur.team_no)), '[]'::jsonb)
          into v_qdrift
          from public.hosted_tournament_bracket_slots s
          join public.hosted_tournament_teams t on t.id = s.team_id
          left join lateral (
              select (st ->> 'teamId')::uuid as team_id
                from jsonb_array_elements(coalesce(v_stand -> 'groups', '[]'::jsonb)) g,
                     jsonb_array_elements(coalesce(g -> 'standings', '[]'::jsonb)) st
               where (g ->> 'groupNo')::integer = s.source_group_no
                 and (st -> 'rank') is not null
                 and (st ->> 'rank')::integer = s.source_rank
               limit 1) now_team on true
          left join public.hosted_tournament_teams cur on cur.id = now_team.team_id
         where s.bracket_id = v_b.id and s.resolved_at is not null
           and now_team.team_id is not null and now_team.team_id <> s.team_id;
    exception when others then
        v_drift  := '[]'::jsonb;
        v_qdrift := '[]'::jsonb;
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
        'qualifierDrift', v_qdrift,
        'validation', public.hosted_tournament_bracket_validate(v_b.id));
end;
$$;

revoke execute on function public.get_admin_bracket(text) from public;
revoke execute on function public.get_admin_bracket(text) from anon;
grant  execute on function public.get_admin_bracket(text) to authenticated;


notify pgrst, 'reload schema';

commit;
