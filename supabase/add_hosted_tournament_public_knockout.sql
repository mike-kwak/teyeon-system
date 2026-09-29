-- =============================================================================
-- 2026 TEYEON OPEN — 공개 본선 대진 계약 (Batch 4D-2)  (2026-09-30)
--
--   이번 Batch 가 하는 일
--     1. publish_bracket / unpublish_bracket — 운영진이 직접 누를 때만 공개 상태가 바뀐다.
--     2. get_public_knockout_bracket — 로그인 없이(anon) 부르는 공개 조회 RPC 하나.
--
--   ★ 확정과 공개는 다른 행위다 (예선 DRAW 와 같은 원칙)
--       lock_bracket    = 본선 경로 확정 (자리 배치를 얼린다)
--       publish_bracket = 본선 대진 공개 (참가자 · 관람객에게 보여 준다)
--     확정해도 자동으로 공개되지 않는다. 자동 publish 경로는 이 파일에도 없다.
--
--   ★ 아직 실제 팀이 정해지지 않아도 공개한다
--     '1조 1위 vs 16조 2위' 를 그대로 보여 주는 것이 이 대회 운영의 핵심이다.
--     예선 결과가 반영되면 source 를 지우지 않고 팀을 함께 내려 준다.
--
--   ⚠ 공개 payload 에 내부 식별자를 넣지 않는다
--     bracket · round · slot · match · team UUID 를 하나도 내보내지 않는다.
--     대신 좌표로 만든 공개 키를 쓴다 — round 'r1' / slot 'r1p3' / match 'r1m2' / team 't12'.
--     registrations 를 join 하지 않는다(연락처 · 입금 · 동의 · 메모 전부 미반환).
--
--   ⚠ additive 전용
--     · 테이블 · 컬럼 · 제약을 만들지 않는다(4A 가 published_at 을 이미 열어 뒀다).
--     · 기존 행을 UPDATE / DELETE 하지 않는다.
--     · 4C 엔진 · 4D-0 qualifier · 예선 · 공개 예선 DRAW 함수를 건드리지 않는다.
--
--   ⚠ 잠금
--     publish / unpublish 는 bracket 잠금만 잡는다(경기를 건드리지 않는다).
--     전역 순서 규칙(matches → bracket)을 어기지 않는다.
--
--   검증  : add_hosted_tournament_public_knockout_verify.sql
--   실동작: verify_hosted_tournament_public_knockout_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_public_knockout_rollback.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_brackets') is null then
        raise exception '본선 Bracket 기반(Batch 4A)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_bracket_begin(text,integer)') is null
       or to_regprocedure('public.hosted_tournament_bracket_bump(uuid)') is null
       or to_regprocedure('public.hosted_tournament_bracket_validate(uuid)') is null then
        raise exception '4A bracket helper 가 없습니다.';
    end if;
    if to_regprocedure('public.resolve_bracket_qualifiers(text,integer)') is null then
        raise exception '본선 Qualifier(Batch 4D-0)가 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_qualifier_label(integer,integer)') is null then
        raise exception 'qualifier 라벨 helper 가 없습니다.';
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'hosted_tournament_brackets'
                      and column_name = 'published_at') then
        raise exception 'hosted_tournament_brackets.published_at 이 없습니다.';
    end if;
end $guard$;


-- ── 1. 내부 helper: 공개 키 ──────────────────────────────────────────────────
--   ⚠ 좌표로만 만든다. UUID 를 섞지 않는다. 같은 대진이면 언제 불러도 같은 값이다.
create or replace function public.hosted_tournament_public_slot_key(
    p_round_no integer,
    p_position integer
)
returns text
language sql
immutable
as $$
    select case when p_round_no is null or p_position is null then null
                else 'r' || p_round_no || 'p' || p_position end;
$$;

revoke execute on function public.hosted_tournament_public_slot_key(integer,integer) from public;
revoke execute on function public.hosted_tournament_public_slot_key(integer,integer) from anon;
revoke execute on function public.hosted_tournament_public_slot_key(integer,integer) from authenticated;


-- ── 2. RPC: 본선 대진 공개 ───────────────────────────────────────────────────
--   ⚠ 경로가 확정(locked)된 뒤에만 공개할 수 있다. draft 는 거부한다.
--   ⚠ 공개는 published_at 만 바꾼다 — 구조 · 자리 · qualifier · 경기를 건드리지 않는다.
create or replace function public.publish_bracket(
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
    v_status   text;
    v_version  integer;
    v_pub      timestamptz;
    v_tstatus  text;
    v_result   jsonb;
    v_warnings jsonb := '[]'::jsonb;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_bid    := (v_begin ->> 'bracketId')::uuid;
    v_status := v_begin ->> 'status';

    -- ★ 확정(lock) ≠ 공개(publish). 확정된 경로만 공개할 수 있다.
    if v_status = 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_locked');
    end if;

    select published_at into v_pub from public.hosted_tournament_brackets where id = v_bid;
    if v_pub is not null then
        return jsonb_build_object('ok', false, 'reason', 'already_published', 'publishedAt', v_pub);
    end if;

    -- 확정 뒤에 상태가 바뀌었을 수 있으므로 공개 직전에 다시 확인한다.
    v_result := public.hosted_tournament_bracket_validate(v_bid);
    if not (v_result ->> 'ok')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed', 'validation', v_result);
    end if;

    -- 대회 자체가 비공개(draft)면 공개 RPC 는 여전히 아무것도 주지 않는다 — 경고만.
    select status into v_tstatus from public.hosted_tournaments where id = v_tid;
    if v_tstatus = 'draft' then
        v_warnings := v_warnings || jsonb_build_array('tournament_not_public');
    end if;
    -- 아직 실제 팀이 정해지지 않은 자리가 있어도 공개할 수 있다(그게 이 대회의 운영 방식이다).
    if (v_result -> 'summary' ->> 'qualifiers')::integer > 0 then
        v_warnings := v_warnings || jsonb_build_array('qualifiers_unresolved');
    end if;

    update public.hosted_tournament_brackets
       set published_at = now(), updated_at = now()
     where id = v_bid
    returning published_at into v_pub;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'publish_bracket',
        jsonb_build_object('publishedAt', null),
        jsonb_build_object('publishedAt', v_pub, 'status', v_status, 'version', v_version,
                           'warnings', v_warnings), null);

    return jsonb_build_object('ok', true, 'version', v_version, 'publishedAt', v_pub,
                              'warnings', v_warnings);
end;
$$;

revoke execute on function public.publish_bracket(text,integer) from public;
revoke execute on function public.publish_bracket(text,integer) from anon;
grant  execute on function public.publish_bracket(text,integer) to authenticated;


-- ── 3. RPC: 본선 대진 공개 해제 ──────────────────────────────────────────────
--   ⚠ 사유 필수. 공개 상태만 되돌린다 — 경로 · 자리 · 경기 · 결과는 그대로 남는다.
create or replace function public.unpublish_bracket(
    p_slug             text,
    p_reason           text,
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
    v_reason  text;
    v_pub     timestamptz;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    if length(v_reason) > 200 then
        return jsonb_build_object('ok', false, 'reason', 'reason_too_long');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;

    select published_at into v_pub from public.hosted_tournament_brackets where id = v_bid;
    if v_pub is null then
        return jsonb_build_object('ok', false, 'reason', 'not_published');
    end if;

    -- ⚠ published_at 하나만 되돌린다. status · 자리 · 경기에는 손대지 않는다.
    update public.hosted_tournament_brackets
       set published_at = null, updated_at = now()
     where id = v_bid;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'unpublish_bracket',
        jsonb_build_object('publishedAt', v_pub),
        jsonb_build_object('publishedAt', null, 'status', v_begin ->> 'status',
                           'version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.unpublish_bracket(text,text,integer) from public;
revoke execute on function public.unpublish_bracket(text,text,integer) from anon;
grant  execute on function public.unpublish_bracket(text,text,integer) to authenticated;


-- ── 4. RPC: 공개 본선 대진 조회 (anon) ───────────────────────────────────────
--   공개 조건 세 가지를 모두 만족할 때만 내용을 준다.
--     ① 대회 공개(draft 아님)  ② 본선 경로 확정(locked 또는 completed)  ③ 공개 시각 존재
--   아니면 {available:false, reason:'not_published'} — 내부 구조를 알려주지 않는다.
--   ⚠ 반환 화이트리스트. UUID · registrations · 운영 메모 · 검증 결과 · 이벤트는 없다.
create or replace function public.get_public_knockout_bracket(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_title    text;
    v_tstatus  text;
    v_b        public.hosted_tournament_brackets%rowtype;
    v_rounds   jsonb;
    v_slots    jsonb;
    v_matches  jsonb;
    v_champion jsonb := null;
    v_final    record;
begin
    select id, status, title into v_tid, v_tstatus, v_title
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('available', false, 'reason', 'not_published');
    end if;

    select * into v_b from public.hosted_tournament_brackets where tournament_id = v_tid;

    -- 하나라도 어긋나면 같은 답을 준다(비공개 사유를 구분해 알려주지 않는다).
    if v_tstatus = 'draft'
       or v_b.id is null
       or v_b.status not in ('locked', 'completed')
       or v_b.published_at is null then
        return jsonb_build_object('available', false, 'reason', 'not_published');
    end if;

    -- ── 라운드 ────────────────────────────────────────────────────────────
    select coalesce(jsonb_agg(jsonb_build_object(
               'publicKey',   'r' || r.round_no,
               'roundNo',     r.round_no,
               'name',        r.name,
               'isFinalRound', r.is_final_slot,
               'slotCount',   (select count(*) from public.hosted_tournament_bracket_slots s
                                where s.round_id = r.id))
               order by r.round_no), '[]'::jsonb)
      into v_rounds
      from public.hosted_tournament_bracket_rounds r
     where r.bracket_id = v_b.id;

    -- ── 자리 ──────────────────────────────────────────────────────────────
    --   qualifier: 아직 팀이 없어도 sourceLabel('1조 1위')을 그대로 내려 준다.
    --   resolve 이후에도 source 를 지우지 않고 team 을 함께 내려 준다.
    select coalesce(jsonb_agg(jsonb_build_object(
               'publicKey',    public.hosted_tournament_public_slot_key(s.round_no, s.position),
               'roundNo',      s.round_no,
               'position',     s.position,
               'slotType',     s.slot_type,
               'sourceKind',   s.source_kind,
               'sourceLabel',  public.hosted_tournament_qualifier_label(s.source_group_no, s.source_rank),
               'resolved',     s.resolved_at is not null,
               'isFinalSlot',  coalesce(fr.is_final_slot, false),
               'feedsSlotPublicKey',
                   public.hosted_tournament_public_slot_key(fs.round_no, fs.position),
               'team', case when t.id is null then null else jsonb_build_object(
                           'publicKey',   't' || t.team_no,
                           'teamNo',      t.team_no,
                           'player1Name', t.player1_name,
                           'player2Name', t.player2_name,
                           'withdrawn',   t.status = 'withdrawn') end)
               order by s.round_no, s.position), '[]'::jsonb)
      into v_slots
      from public.hosted_tournament_bracket_slots s
      left join public.hosted_tournament_teams t on t.id = s.team_id
      left join public.hosted_tournament_bracket_slots fs on fs.id = s.feeds_slot_id
      left join public.hosted_tournament_bracket_rounds fr on fr.id = s.round_id
     where s.bracket_id = v_b.id;

    -- ── 경기 ──────────────────────────────────────────────────────────────
    --   코트는 진행 중일 때만, 점수 · 승자는 완료일 때만 내려 준다(예선 공개와 같은 규약).
    select coalesce(jsonb_agg(jsonb_build_object(
               'publicKey',   'r' || m.round_no || 'm' || ts.position,
               'roundNo',     m.round_no,
               'roundName',   r.name,
               'matchNo',     m.match_no,
               'status',      m.status,
               'courtNo',     case when m.status = 'playing' then c.court_no end,
               'courtName',   case when m.status = 'playing' then c.display_name end,
               'score1',      case when m.status = 'completed' then m.score1 end,
               'score2',      case when m.status = 'completed' then m.score2 end,
               'winnerSide',  case when m.status <> 'completed' then null
                                   when m.winner_team_id = m.team1_id then 1
                                   when m.winner_team_id = m.team2_id then 2 end,
               'targetSlotPublicKey',
                   public.hosted_tournament_public_slot_key(ts.round_no, ts.position),
               'feederSlotPublicKeys', (
                   select coalesce(jsonb_agg(
                              public.hosted_tournament_public_slot_key(f.round_no, f.position)
                              order by f.position), '[]'::jsonb)
                     from public.hosted_tournament_bracket_slots f
                    where f.feeds_slot_id = ts.id),
               'team1', jsonb_build_object('publicKey', 't' || t1.team_no, 'teamNo', t1.team_no,
                                           'player1Name', t1.player1_name, 'player2Name', t1.player2_name,
                                           'withdrawn', t1.status = 'withdrawn'),
               'team2', jsonb_build_object('publicKey', 't' || t2.team_no, 'teamNo', t2.team_no,
                                           'player1Name', t2.player1_name, 'player2Name', t2.player2_name,
                                           'withdrawn', t2.status = 'withdrawn'))
               order by ts.round_no, ts.position), '[]'::jsonb)
      into v_matches
      from public.hosted_tournament_matches m
      join public.hosted_tournament_bracket_slots ts on ts.id = m.bracket_target_slot_id
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_bracket_rounds r
        on r.bracket_id = v_b.id and r.round_no = m.round_no
      left join public.hosted_tournament_courts c on c.id = m.court_id
     where m.bracket_id = v_b.id and m.stage = 'knockout' and m.status <> 'cancelled';

    -- ── 우승 ──────────────────────────────────────────────────────────────
    --   ⚠ 본선이 완료되기 전에는 우승자를 만들어 내지 않는다.
    if v_b.status = 'completed' then
        select t.team_no, t.player1_name, t.player2_name into v_final
          from public.hosted_tournament_bracket_slots s
          join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
          join public.hosted_tournament_teams t on t.id = s.team_id
         where s.bracket_id = v_b.id and r.is_final_slot and s.slot_type = 'team'
         limit 1;
        if v_final.team_no is not null then
            v_champion := jsonb_build_object(
                'publicKey', 't' || v_final.team_no, 'teamNo', v_final.team_no,
                'player1Name', v_final.player1_name, 'player2Name', v_final.player2_name);
        end if;
    end if;

    return jsonb_build_object(
        'available', true,
        'tournament', jsonb_build_object('slug', p_slug, 'title', v_title),
        'publication', jsonb_build_object(
            'published', true,
            'publishedAt', v_b.published_at,
            'bracketStatus', v_b.status),
        'bracket', jsonb_build_object(
            'title', v_b.title,
            'status', v_b.status,
            'version', v_b.version,
            'completedAt', v_b.completed_at),
        'rounds', v_rounds,
        'slots', v_slots,
        'matches', v_matches,
        'champion', v_champion);
end;
$$;

revoke execute on function public.get_public_knockout_bracket(text) from public;
grant  execute on function public.get_public_knockout_bracket(text) to anon;
grant  execute on function public.get_public_knockout_bracket(text) to authenticated;


notify pgrst, 'reload schema';

commit;
