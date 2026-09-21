-- ============================================================================
--  2026 TEYEON OPEN — Public Preliminary DRAW 공개 계약 + 순위 계산 코어 분리
--
--  무엇을 하나
--    1. hosted_tournaments.preliminary_draw_published_at 추가 (NULL = 비공개)
--       ⚠ preliminary_draw_status = locked(운영 잠금)와 다른 개념이다. LOCK 이 자동 공개가 아니다.
--    2. 순위 계산 코어 분리 — hosted_tournament_preliminary_standings_core(uuid)
--       get_preliminary_standings 의 계산식을 **글자 그대로** 옮기고, 기존 RPC 는
--       권한 확인 + 코어 호출 래퍼가 된다(반환 모양 동일). 공개 RPC 도 같은 코어를 쓴다.
--    3. publish_preliminary_draw / unpublish_preliminary_draw (운영진 전용, audit)
--    4. unlock_preliminary_draw 재생성 — 공개 중이면 같은 트랜잭션에서 자동 비공개 + audit
--       (가산적 변경만. 자동 재공개 없음)
--    5. get_admin_preliminary_draw_publication (운영 화면 공개 상태 조회)
--    6. get_public_preliminary_draw (anon 실행 가능 · 공개 조건 3개 · 최소 필드)
--
--  ⚠ 적용 전 반드시: Batch 3B 검증 재실행 계획 확인(APPLY_CHECKLIST 참고).
--  ⚠ 원본 테이블 권한 / RLS 는 바꾸지 않는다. 운영 데이터 행을 수정하지 않는다.
--  롤백: add_hosted_tournament_public_draw_rollback.sql
--  검증: add_hosted_tournament_public_draw_verify.sql (읽기 전용)
--        verify_hosted_tournament_public_draw_fixture.sql (self-test, 전량 롤백)
--        add_hosted_tournament_standings_verify_core.sql (3B 카탈로그 81항목을 코어 기준으로 재지정)
--        verify_hosted_tournament_standings_fixture.sql (3B 기능 60항목 — 수정 없이 재실행)
-- ============================================================================

begin;

-- ── 1. 공개 시각 컬럼 ────────────────────────────────────────────────────────
--   nullable · default 없음 → 기존 행은 전부 비공개(NULL)로 시작한다. 테이블 재작성 없음.
alter table public.hosted_tournaments
    add column if not exists preliminary_draw_published_at timestamptz;

comment on column public.hosted_tournaments.preliminary_draw_published_at is
    'NULL = 공개 DRAW 비공개 / NOT NULL = 공개 시각. locked(운영 잠금)와 별개이며 unlock 시 자동으로 NULL.';


-- ── 2. 순위 계산 코어 (내부 전용) ────────────────────────────────────────────
create or replace function public.hosted_tournament_preliminary_standings_core(p_tid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid := p_tid;
    -- 요강: 각 조 상위 2팀 본선 진출. 규칙이 바뀌면 이 한 곳만 고친다.
    v_qualify integer := 2;
    v_groups  jsonb;
    v_place   jsonb;
begin
    if v_tid is null then return null; end if;

    -- ⚠⚠ 아래 계산식은 Batch 3B get_preliminary_standings 본문을 한 글자도 바꾸지 않고 옮긴 것이다.
    --     (정렬 키 · 동률 · 진출 판정 · CANCELLED · placement 분리 · 결과 지문 · 확정 반영 전부 동일)
    with grp as (
        select g.id, g.group_no, g.expected_size
          from public.hosted_tournament_groups g
         where g.tournament_id = v_tid and g.group_type = 'preliminary'
    ),
    -- ⚠ placement 이중 필터: stage 와 group_type 둘 다 preliminary 여야 한다.
    mall as (
        select m.id, m.group_id, m.status, m.score1, m.score2,
               m.team1_id, m.team2_id, m.winner_team_id
          from public.hosted_tournament_matches m
          join grp on grp.id = m.group_id
         where m.tournament_id = v_tid and m.stage = 'preliminary'
    ),
    -- ⚠ CANCELLED / WAITING / CALLING / PLAYING 은 계산에서 완전히 제외한다.
    mdone as (select * from mall where status = 'completed'),
    gcnt as (
        select grp.id as gid,
               count(mall.id)                                       as generated,
               count(mall.id) filter (where mall.status='completed') as completed,
               count(mall.id) filter (where mall.status='cancelled') as cancelled
          from grp left join mall on mall.group_id = grp.id
         group by grp.id
    ),
    gfp as (
        select grp.id as gid,
               md5(coalesce(string_agg(
                   mdone.id::text || ':' || mdone.score1::text || ':' || mdone.score2::text,
                   '|' order by mdone.id), '')) as fp
          from grp left join mdone on mdone.group_id = grp.id
         group by grp.id
    ),
    mem as (
        select mm.group_id, mm.team_id, mm.slot_no
          from public.hosted_tournament_group_members mm
          join grp on grp.id = mm.group_id
    ),
    memn as (select group_id, count(*) as n from mem group by group_id),
    sided as (
        select group_id, team1_id as team_id, score1 as gf, score2 as ga,
               (winner_team_id = team1_id) as won from mdone
        union all
        select group_id, team2_id as team_id, score2 as gf, score1 as ga,
               (winner_team_id = team2_id) as won from mdone
    ),
    -- 경기가 0인 팀도 반드시 나와야 하므로 멤버 기준 left join.
    agg as (
        select mem.group_id, mem.team_id, mem.slot_no,
               count(s.team_id)                       as played,
               count(*) filter (where s.won)          as wins,
               count(*) filter (where s.won is false) as losses,
               coalesce(sum(s.gf), 0)                 as gf,
               coalesce(sum(s.ga), 0)                 as ga
          from mem
          left join sided s on s.group_id = mem.group_id and s.team_id = mem.team_id
         group by mem.group_id, mem.team_id, mem.slot_no
    ),
    calc as (
        -- ⚠ numeric 나눗셈. float 은 표현 오차로 동률을 놓칠 수 있다.
        select a.*, (a.wins::numeric / nullif(a.played, 0)) as win_rate,
               (a.gf - a.ga) as game_diff
          from agg a
    ),
    ranked as (
        -- ⚠ 정렬 키는 승률 · 득실 둘뿐. 3차 tie-breaker 를 두지 않는다.
        select c.*,
               rank() over (partition by c.group_id
                            order by c.win_rate desc nulls last, c.game_diff desc) as auto_rank
          from calc c
    ),
    tie as (
        select group_id, auto_rank, count(*) as tsize
          from ranked group by group_id, auto_rank having count(*) > 1
    ),
    res as (
        select r.group_id, r.team_id, r.resolved_order, r.reason, r.resolved_at
          from public.hosted_tournament_group_tie_resolutions r
         where r.tournament_id = v_tid and r.invalidated_at is null
    ),
    -- tie group 은 '모든 구성원'이 확정됐을 때만 resolved 다.
    tie_state as (
        select t.group_id, t.auto_rank, t.tsize,
               (select count(*) from ranked rk
                  join res rr on rr.group_id = rk.group_id and rr.team_id = rk.team_id
                 where rk.group_id = t.group_id and rk.auto_rank = t.auto_rank) = t.tsize as resolved
          from tie t
    ),
    gstate as (
        select grp.id as gid, grp.group_no, grp.expected_size,
               gcnt.generated, gcnt.completed, gcnt.cancelled, gfp.fp,
               coalesce(memn.n, 0) as members,
               (gcnt.generated > 0 and gcnt.completed = gcnt.generated) as complete,
               exists (select 1 from tie_state ts
                        where ts.group_id = grp.id and not ts.resolved) as has_unresolved
          from grp
          join gcnt on gcnt.gid = grp.id
          join gfp  on gfp.gid  = grp.id
          left join memn on memn.group_id = grp.id
    )
    select coalesce(jsonb_agg(row_json order by group_no), '[]'::jsonb)
      into v_groups
      from (
        select gs.group_no,
               jsonb_build_object(
                 'groupId',           gs.gid,
                 'groupNo',           gs.group_no,
                 'groupType',         'preliminary',
                 'expectedSize',      gs.expected_size,
                 'members',           gs.members,
                 -- N(N-1)/2 일반식. 조 크기를 하드코딩하지 않는다.
                 'expectedMatches',   (gs.members * (gs.members - 1)) / 2,
                 'generatedMatches',  gs.generated,
                 'completedMatches',  gs.completed,
                 'cancelledMatches',  gs.cancelled,
                 'groupComplete',     gs.complete,
                 'resultsFingerprint', gs.fp,
                 'rankingStatus',
                     case when not gs.complete             then 'PROVISIONAL'
                          when gs.has_unresolved           then 'AGE_CHECK_REQUIRED'
                          else 'FINAL' end,
                 -- CANCELLED 가 남아 있으면 운영 정책 판단이 필요하다(자동 확정 금지).
                 'policyRequired',
                     case when gs.cancelled > 0 then 'cancelled_matches_present' else null end,
                 'tieGroups', coalesce((
                     select jsonb_agg(jsonb_build_object(
                                'rank',     ts.auto_rank,
                                'size',     ts.tsize,
                                'resolved', ts.resolved,
                                'teamIds',  (select jsonb_agg(rk2.team_id order by rk2.slot_no)
                                               from ranked rk2
                                              where rk2.group_id = ts.group_id
                                                and rk2.auto_rank = ts.auto_rank)
                            ) order by ts.auto_rank)
                       from tie_state ts where ts.group_id = gs.gid), '[]'::jsonb),
                 'standings', coalesce((
                     select jsonb_agg(jsonb_build_object(
                                'teamId',        rk.team_id,
                                'teamNo',        t.team_no,
                                'player1Name',   t.player1_name,
                                'player2Name',   t.player2_name,
                                'teamStatus',    t.status,
                                'played',        rk.played,
                                'wins',          rk.wins,
                                'losses',        rk.losses,
                                'gamesFor',      rk.gf,
                                'gamesAgainst',  rk.ga,
                                'gameDiff',      rk.game_diff,
                                'winRate',       case when rk.win_rate is null then null
                                                      else round(rk.win_rate, 4) end,
                                'autoRank',      rk.auto_rank,
                                -- 완료 + 미해결 동률이면 rank 를 만들어내지 않는다(null).
                                'rank',
                                    case when rs.resolved_order is not null then rs.resolved_order
                                         when ts.tsize is null              then rk.auto_rank
                                         when not gs.complete               then rk.auto_rank
                                         else null end,
                                'tieGroupRank',  ts.auto_rank,
                                'tieGroupSize',  ts.tsize,
                                'resolvedOrder', rs.resolved_order,
                                'resolvedAt',    rs.resolved_at,
                                'resolvedReason', rs.reason,
                                'qualificationStatus',
                                    case
                                      when not gs.complete then 'PENDING'
                                      when rs.resolved_order is not null then
                                           case when rs.resolved_order <= v_qualify
                                                then 'QUALIFIED' else 'NOT_QUALIFIED' end
                                      when ts.tsize is null then
                                           case when rk.auto_rank <= v_qualify
                                                then 'QUALIFIED' else 'NOT_QUALIFIED' end
                                      -- 동률 묶음이 통째로 진출권 안쪽이면 순서와 무관하게 진출 확정
                                      when rk.auto_rank + ts.tsize - 1 <= v_qualify then 'QUALIFIED'
                                      -- 통째로 진출권 밖이면 탈락 확정
                                      when rk.auto_rank > v_qualify then 'NOT_QUALIFIED'
                                      -- 경계에 걸치면 순서가 정해져야 판정할 수 있다
                                      else 'PENDING' end
                            ) order by
                                case when rs.resolved_order is not null then rs.resolved_order
                                     else rk.auto_rank end,
                                rk.slot_no)
                       from ranked rk
                       join public.hosted_tournament_teams t on t.id = rk.team_id
                       left join tie_state ts
                         on ts.group_id = rk.group_id and ts.auto_rank = rk.auto_rank
                       left join res rs
                         on rs.group_id = rk.group_id and rs.team_id = rk.team_id
                      where rk.group_id = gs.gid), '[]'::jsonb)
               ) as row_json
          from gstate gs
      ) s;

    -- ── placement — standings 와 완전히 분리해서 winner/loser 만 제공한다. ──
    --   두 팀 모두 본선 진출이며 knockout slot 을 여기서 만들지 않는다.
    select coalesce(jsonb_agg(jsonb_build_object(
               'groupId',      g.id,
               'groupNo',      g.group_no,
               'matchId',      m.id,
               'matchNo',      m.match_no,
               'status',       m.status,
               'score1',       m.score1,
               'score2',       m.score2,
               'winnerTeamId', m.winner_team_id,
               'loserTeamId',  case when m.winner_team_id is null then null
                                    when m.winner_team_id = m.team1_id then m.team2_id
                                    else m.team1_id end,
               'teams', jsonb_build_array(
                   jsonb_build_object('teamId', t1.id, 'teamNo', t1.team_no,
                                      'player1Name', t1.player1_name,
                                      'player2Name', t1.player2_name),
                   jsonb_build_object('teamId', t2.id, 'teamNo', t2.team_no,
                                      'player1Name', t2.player1_name,
                                      'player2Name', t2.player2_name))
           ) order by g.group_no), '[]'::jsonb)
      into v_place
      from public.hosted_tournament_groups g
      join public.hosted_tournament_matches m
        on m.group_id = g.id and m.stage = 'placement'
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
     where g.tournament_id = v_tid and g.group_type = 'placement';

    return jsonb_build_object(
        'qualifyPerGroup', v_qualify,
        'groups',          v_groups,
        'placement',       v_place
    );
end;
$$;

-- 내부 전용 — 누구도 직접 실행하지 못한다(운영 래퍼 · 공개 래퍼만 호출).
revoke execute on function public.hosted_tournament_preliminary_standings_core(uuid) from public;
revoke execute on function public.hosted_tournament_preliminary_standings_core(uuid) from anon;
revoke execute on function public.hosted_tournament_preliminary_standings_core(uuid) from authenticated;


-- ── 3. 운영 순위 RPC — 코어 래퍼로 재생성(반환 계약 동일) ────────────────────
create or replace function public.get_preliminary_standings(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_core jsonb;
begin
    if not public.can_manage_tournaments() then
        return null;   -- 권한 없음은 '빈 목록'이 아니라 null 로 구분한다
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    -- ⚠ 순위 계산은 공용 코어 한 곳에서만 한다(Admin · Public 이 같은 식을 쓴다).
    v_core := public.hosted_tournament_preliminary_standings_core(v_tid);

    -- 반환 모양은 Batch 3B 와 동일하다(slug · qualifyPerGroup · groups · placement).
    return jsonb_build_object(
        'slug',            p_slug,
        'qualifyPerGroup', v_core -> 'qualifyPerGroup',
        'groups',          v_core -> 'groups',
        'placement',       v_core -> 'placement'
    );
end;
$$;

revoke execute on function public.get_preliminary_standings(text) from public;
revoke execute on function public.get_preliminary_standings(text) from anon;
grant  execute on function public.get_preliminary_standings(text) to authenticated;


-- ── 4. 공개 / 비공개 RPC ────────────────────────────────────────────────────
create or replace function public.publish_preliminary_draw(
    p_slug             text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_status    text;
    v_version   integer;
    v_pub       timestamptz;
    v_tstatus   text;
    v_result    jsonb;
    v_warnings  jsonb := '[]'::jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    -- 조편성 write 와 같은 네임스페이스 — lock/unlock 과 직렬화된다.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-groups:' || v_tid::text));

    -- 락 이후 재조회 — 락 전 값은 신뢰하지 않는다.
    select preliminary_draw_status, preliminary_draw_version, preliminary_draw_published_at, status
      into v_status, v_version, v_pub, v_tstatus
      from public.hosted_tournaments where id = v_tid;

    -- ⚠ LOCKED 와 PUBLISHED 는 다른 개념이다. 공개는 잠긴 조편성에서만 가능하다.
    if v_status <> 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'draw_not_locked', 'version', v_version);
    end if;
    if p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;
    if v_pub is not null then
        return jsonb_build_object('ok', false, 'reason', 'draw_already_published',
                                  'version', v_version, 'publishedAt', v_pub);
    end if;

    -- 잠긴 뒤에 상태가 바뀌었을 수 있으므로 조편성 유효성을 '다시' 확인한다.
    v_result := public.hosted_tournament_draw_validate(v_tid);
    if not (v_result ->> 'ok')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed',
                                  'validation', v_result, 'version', v_version);
    end if;

    -- 대회 자체가 비공개(draft)면 공개 RPC 는 여전히 아무것도 주지 않는다 — 경고만.
    if v_tstatus = 'draft' then
        v_warnings := v_warnings || jsonb_build_array('tournament_not_public');
    end if;

    update public.hosted_tournaments
       set preliminary_draw_published_at = now(),
           updated_at                    = now()
     where id = v_tid
    returning preliminary_draw_published_at into v_pub;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'publish_preliminary_draw',
        jsonb_build_object('publishedAt', null),
        jsonb_build_object('publishedAt', v_pub, 'version', v_version,
                           'tournamentStatus', v_tstatus, 'warnings', v_warnings),
        p_slug);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'publishedAt', v_pub, 'warnings', v_warnings);
end;
$$;

revoke execute on function public.publish_preliminary_draw(text,integer) from public;
revoke execute on function public.publish_preliminary_draw(text,integer) from anon;
grant  execute on function public.publish_preliminary_draw(text,integer) to authenticated;


create or replace function public.unpublish_preliminary_draw(
    p_slug             text,
    p_reason           text,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_version integer;
    v_pub     timestamptz;
    v_reason  text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-groups:' || v_tid::text));

    select preliminary_draw_version, preliminary_draw_published_at
      into v_version, v_pub
      from public.hosted_tournaments where id = v_tid;

    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;
    if v_pub is null then
        return jsonb_build_object('ok', false, 'reason', 'draw_not_published', 'version', v_version);
    end if;

    update public.hosted_tournaments
       set preliminary_draw_published_at = null,
           updated_at                    = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'unpublish_preliminary_draw',
        jsonb_build_object('publishedAt', v_pub),
        jsonb_build_object('publishedAt', null, 'cause', 'manual', 'version', v_version),
        v_reason);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.unpublish_preliminary_draw(text,text,integer) from public;
revoke execute on function public.unpublish_preliminary_draw(text,text,integer) from anon;
grant  execute on function public.unpublish_preliminary_draw(text,text,integer) to authenticated;


-- ── 5. unlock 재생성 — 공개 중이면 자동 비공개 ──────────────────────────────
create or replace function public.unlock_preliminary_draw(
    p_slug             text,
    p_reason           text,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_status    text;
    v_version   integer;
    v_reason    text;
    v_active    integer := 0;   -- playing + completed
    v_total     integer := 0;
    v_reset     integer := 0;   -- calling → waiting
    v_warnings  jsonb := '[]'::jsonb;
    v_was_pub   timestamptz;    -- 공개 DRAW 였는가(자동 비공개 판단용)
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-groups:' || v_tid::text));

    select preliminary_draw_status, preliminary_draw_version, preliminary_draw_published_at
      into v_status, v_version, v_was_pub
      from public.hosted_tournaments where id = v_tid;

    if v_status <> 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'draw_not_locked', 'version', v_version);
    end if;
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    -- 경기 보호 — 진행/완료된 경기가 있으면 조편성을 흔들 수 없다.
    select count(*) filter (where status in ('playing', 'completed')),
           count(*)
      into v_active, v_total
      from public.hosted_tournament_matches where tournament_id = v_tid;

    if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'matches_in_progress',
                                  'activeMatches', v_active, 'version', v_version);
    end if;

    -- 호명 상태 초기화. ⚠ CANCELLED 는 건드리지 않고, 경기를 삭제하지도 않는다.
    update public.hosted_tournament_matches
       set status = 'waiting', called_at = null,
           version = version + 1, updated_at = now()
     where tournament_id = v_tid and status = 'calling';
    get diagnostics v_reset = row_count;

    if v_total > 0 then
        v_warnings := v_warnings || jsonb_build_array('matches_exist');
    end if;
    if v_reset > 0 then
        v_warnings := v_warnings || jsonb_build_array('calling_reset');
    end if;

    update public.hosted_tournaments
       set preliminary_draw_status    = 'draft',
           -- ⚠ 공개 중이던 DRAW 는 같은 트랜잭션에서 자동 비공개. 다시 LOCK 해도 자동 재공개하지 않는다.
           preliminary_draw_published_at = null,
           preliminary_draw_locked_at = null,
           preliminary_draw_locked_by = null,
           updated_at                 = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'unlock_preliminary_draw', null,
        jsonb_build_object('version', v_version, 'existingMatches', v_total,
                           'callingReset', v_reset, 'warnings', v_warnings,
                           'publicDrawUnpublished', v_was_pub is not null), v_reason);

    -- 공개 중이었다면 '공개 취소' 사실을 별도 이벤트로 남긴다(원인: unlock). PII 없음.
    if v_was_pub is not null then
        perform public.hosted_tournament_log_event(
            v_tid, 'tournament', v_tid, 'unpublish_preliminary_draw',
            jsonb_build_object('publishedAt', v_was_pub),
            jsonb_build_object('publishedAt', null, 'cause', 'draw_unlocked', 'version', v_version),
            'auto: public draw unpublished due to unlock');
    end if;

    return jsonb_build_object('ok', true, 'version', v_version,
                              'existingMatches', v_total, 'callingReset', v_reset,
                              'warnings', v_warnings,
                              'publicDrawUnpublished', v_was_pub is not null);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from public;
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from anon;
grant  execute on function public.unlock_preliminary_draw(text,text,integer) to authenticated;


-- ── 6. 운영 화면용 공개 상태 조회 ───────────────────────────────────────────
create or replace function public.get_admin_preliminary_draw_publication(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_t record;
begin
    if not public.can_manage_tournaments() then
        return null;
    end if;
    select slug, status, preliminary_draw_status, preliminary_draw_version, preliminary_draw_published_at
      into v_t
      from public.hosted_tournaments where slug = p_slug;
    if v_t.slug is null then return null; end if;
    return jsonb_build_object(
        'slug',             v_t.slug,
        'tournamentStatus', v_t.status,
        'drawStatus',       v_t.preliminary_draw_status,
        'drawVersion',      v_t.preliminary_draw_version,
        'publishedAt',      v_t.preliminary_draw_published_at
    );
end;
$$;

revoke execute on function public.get_admin_preliminary_draw_publication(text) from public;
revoke execute on function public.get_admin_preliminary_draw_publication(text) from anon;
grant  execute on function public.get_admin_preliminary_draw_publication(text) to authenticated;


-- ── 7. 공개 DRAW 조회 (anon) ────────────────────────────────────────────────
create or replace function public.get_public_preliminary_draw(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_tstatus text;
    v_dstatus text;
    v_pub     timestamptz;
    v_core    jsonb;
    v_groups  jsonb;
    v_place   jsonb;
begin
    select id, status, preliminary_draw_status, preliminary_draw_published_at
      into v_tid, v_tstatus, v_dstatus, v_pub
      from public.hosted_tournaments where slug = p_slug;

    -- 공개 조건 세 가지를 모두 만족할 때만 반환한다. 아니면 null(이유를 알려주지 않는다).
    --   ① 대회 공개(draft 아님)  ② 조편성 locked  ③ DRAW 공개 시각 존재
    if v_tid is null
       or v_tstatus = 'draft'
       or v_dstatus <> 'locked'
       or v_pub is null then
        return null;
    end if;

    -- ⚠ 운영 화면과 같은 계산 코어 — 순위 · 진출 · 동률 상태가 절대 다르게 나올 수 없다.
    v_core := public.hosted_tournament_preliminary_standings_core(v_tid);

    -- ── 조: 공개 필드만 골라 담는다(uuid · 지문 · 동률 상세 · 확정 사유 미반환) ──
    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo',          (grp.j ->> 'groupNo')::integer,
               'members',          (grp.j ->> 'members')::integer,
               'expectedMatches',  (grp.j ->> 'expectedMatches')::integer,
               'generatedMatches', (grp.j ->> 'generatedMatches')::integer,
               'completedMatches', (grp.j ->> 'completedMatches')::integer,
               'cancelledMatches', (grp.j ->> 'cancelledMatches')::integer,
               'rankingStatus',    grp.j ->> 'rankingStatus',
               'standings', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'teamNo',              (st.j ->> 'teamNo')::integer,
                              'player1Name',         st.j ->> 'player1Name',
                              'player2Name',         st.j ->> 'player2Name',
                              'withdrawn',           (st.j ->> 'teamStatus') = 'withdrawn',
                              'played',              (st.j ->> 'played')::integer,
                              'wins',                (st.j ->> 'wins')::integer,
                              'losses',              (st.j ->> 'losses')::integer,
                              'gamesFor',            (st.j ->> 'gamesFor')::integer,
                              'gamesAgainst',        (st.j ->> 'gamesAgainst')::integer,
                              'gameDiff',            (st.j ->> 'gameDiff')::integer,
                              'rank',                st.j -> 'rank',
                              'qualificationStatus', st.j ->> 'qualificationStatus'
                          ) order by st.ord), '[]'::jsonb)
                     from jsonb_array_elements(grp.j -> 'standings') with ordinality as st(j, ord)),
               'matches', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'sequenceNo', mt.sequence_no,
                              'matchNo',    mt.match_no,
                              'status',     mt.status,
                              'courtNo',    case when mt.status = 'playing' then ct.court_no end,
                              'courtName',  case when mt.status = 'playing' then ct.display_name end,
                              'score1',     case when mt.status = 'completed' then mt.score1 end,
                              'score2',     case when mt.status = 'completed' then mt.score2 end,
                              'winnerSide', case when mt.status <> 'completed' then null
                                                 when mt.winner_team_id = mt.team1_id then 1
                                                 when mt.winner_team_id = mt.team2_id then 2 end,
                              'team1', jsonb_build_object('teamNo', t1.team_no,
                                                          'player1Name', t1.player1_name,
                                                          'player2Name', t1.player2_name),
                              'team2', jsonb_build_object('teamNo', t2.team_no,
                                                          'player1Name', t2.player1_name,
                                                          'player2Name', t2.player2_name)
                          ) order by mt.sequence_no), '[]'::jsonb)
                     from public.hosted_tournament_matches mt
                     join public.hosted_tournament_teams t1 on t1.id = mt.team1_id
                     join public.hosted_tournament_teams t2 on t2.id = mt.team2_id
                     left join public.hosted_tournament_courts ct on ct.id = mt.court_id
                    where mt.tournament_id = v_tid
                      and mt.stage = 'preliminary'
                      and mt.group_id = (grp.j ->> 'groupId')::uuid)
           ) order by (grp.j ->> 'groupNo')::integer), '[]'::jsonb)
      into v_groups
      from jsonb_array_elements(v_core -> 'groups') as grp(j);

    -- ── 순위결정전: 일반 조와 분리. 두 팀 · 상태 · 점수 · 승자 쪽만 ──
    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo',    (pl.j ->> 'groupNo')::integer,
               'matchNo',    (pl.j ->> 'matchNo')::integer,
               'status',     pl.j ->> 'status',
               'score1',     case when pl.j ->> 'status' = 'completed' then pl.j -> 'score1' end,
               'score2',     case when pl.j ->> 'status' = 'completed' then pl.j -> 'score2' end,
               'winnerSide', case when pl.j ->> 'status' <> 'completed' then null
                                  when (pl.j ->> 'winnerTeamId') = (pl.j -> 'teams' -> 0 ->> 'teamId') then 1
                                  when (pl.j ->> 'winnerTeamId') = (pl.j -> 'teams' -> 1 ->> 'teamId') then 2 end,
               'teams', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'teamNo',      (tm.j ->> 'teamNo')::integer,
                              'player1Name', tm.j ->> 'player1Name',
                              'player2Name', tm.j ->> 'player2Name'
                          ) order by tm.ord), '[]'::jsonb)
                     from jsonb_array_elements(pl.j -> 'teams') with ordinality as tm(j, ord))
           ) order by (pl.j ->> 'groupNo')::integer), '[]'::jsonb)
      into v_place
      from jsonb_array_elements(v_core -> 'placement') as pl(j);

    return jsonb_build_object(
        'slug',            p_slug,
        'published',       true,
        'qualifyPerGroup', v_core -> 'qualifyPerGroup',
        'groups',          v_groups,
        'placement',       v_place
    );
    -- ⚠ 미반환: tournament/group/team/match uuid, resultsFingerprint, tieGroups 상세,
    --           autoRank, winRate, resolvedOrder/resolvedAt/resolvedReason, version,
    --           publishedAt, 접수 원장(연락처 · 입금 · 동의 · 메모) 일체, 나이 · 생년 계열 없음.
end;
$$;

-- 공개 조회 — 로그인 없이 실행 가능. ⚠ 원본 테이블 SELECT 권한은 여전히 운영진 전용(RLS).
revoke execute on function public.get_public_preliminary_draw(text) from public;
grant  execute on function public.get_public_preliminary_draw(text) to anon;
grant  execute on function public.get_public_preliminary_draw(text) to authenticated;

commit;
