-- ============================================================================
--  2026 TEYEON OPEN — Public Preliminary DRAW 롤백
--
--  add_hosted_tournament_public_draw.sql 를 되돌린다.
--    · get_preliminary_standings / unlock_preliminary_draw 를 **기존 적용 본문 그대로** 복원
--    · 새 함수 5개 삭제 → 공개 시각 컬럼 삭제
--  ⚠ 컬럼을 지우면 공개 상태가 사라진다(공개 DRAW 는 즉시 비공개가 된다).
-- ============================================================================

begin;

-- 1. 기존 본문 복원 (add_hosted_tournament_standings.sql / add_hosted_tournament_matches.sql 원문)
create or replace function public.get_preliminary_standings(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    -- 요강: 각 조 상위 2팀 본선 진출. 규칙이 바뀌면 이 한 곳만 고친다.
    v_qualify integer := 2;
    v_groups  jsonb;
    v_place   jsonb;
begin
    if not public.can_manage_tournaments() then
        return null;   -- 권한 없음은 '빈 목록'이 아니라 null 로 구분한다
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

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
        'slug',          p_slug,
        'qualifyPerGroup', v_qualify,
        'groups',        v_groups,
        'placement',     v_place
    );
end;
$$;

revoke execute on function public.get_preliminary_standings(text) from public;
revoke execute on function public.get_preliminary_standings(text) from anon;
grant  execute on function public.get_preliminary_standings(text) to authenticated;

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

    select preliminary_draw_status, preliminary_draw_version
      into v_status, v_version
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
           preliminary_draw_locked_at = null,
           preliminary_draw_locked_by = null,
           updated_at                 = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'unlock_preliminary_draw', null,
        jsonb_build_object('version', v_version, 'existingMatches', v_total,
                           'callingReset', v_reset, 'warnings', v_warnings), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'existingMatches', v_total, 'callingReset', v_reset,
                              'warnings', v_warnings);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from public;
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from anon;
grant  execute on function public.unlock_preliminary_draw(text,text,integer) to authenticated;

-- 2. 새 함수 삭제 (복원한 standings 가 더 이상 코어를 부르지 않으므로 코어는 마지막에)
drop function if exists public.get_public_preliminary_draw(text);
drop function if exists public.get_admin_preliminary_draw_publication(text);
drop function if exists public.unpublish_preliminary_draw(text,text,integer);
drop function if exists public.publish_preliminary_draw(text,integer);
drop function if exists public.hosted_tournament_preliminary_standings_core(uuid);

-- 3. 컬럼 삭제
alter table public.hosted_tournaments drop column if exists preliminary_draw_published_at;

commit;
