-- ============================================================================
--  2026 TEYEON OPEN — 예선 순위 / 합산연령 동률 확정 (Batch 3B)
--
--  선행: Batch 1 4종 + Batch 2A + bulk follow-up + Batch 3A(matches) 운영 적용 완료
--
--  범위: standings 계산 RPC · tie 탐지 · 순위 확정(resolution) · amend 연동 · verify/rollback
--  제외: Admin/Public standings UI · Knockout · bracket slot · Realtime · Arena
--
--  ⚠⚠ 개인정보
--    DOB · 생년 · 나이 · 합산연령 값을 **저장하지 않는다**. 앞으로도 컬럼을 만들지 않는다.
--    운영진이 현장에서 합산연령을 확인한 뒤 '최종 순서'만 남긴다.
--
--  ⚠ 순위 정렬은 승률 → 게임 득실 **두 단계에서 끝난다.**
--    team_no · 이름 · UUID · 등록순 · seed · match_no 를 3차 정렬 키로 쓰지 않는다.
--
--  ⚠ 기권 / 노쇼는 이미 일반 6:0 COMPLETED 로 저장되므로 별도 분기가 없다.
--
--  ⚠ CANCELLED 정책 (확정)
--    공식 결과가 아니므로 played · wins · losses · gamesFor/Against · gameDiff
--    **어디에도 포함하지 않는다.** 그리고 CANCELLED 가 하나라도 남아 있으면
--    그 조는 FINAL 이 되지 않는다(PROVISIONAL + policyRequired).
--    0:0 이나 6:0 으로 자동 변환하지 않는다.
--
--  ⚠ standings snapshot 테이블을 만들지 않는다. 항상 matches 에서 계산한다.
-- ============================================================================

begin;

-- ── 1. 동률 확정 기록 ───────────────────────────────────────────────────────
--   ⚠ 저장하는 것은 '운영진이 확인했고 순서는 이렇다'는 사실뿐이다.
--     나이·생년·합산연령 숫자를 담는 컬럼이 없다.
create table if not exists public.hosted_tournament_group_tie_resolutions (
    id                  uuid        primary key default gen_random_uuid(),
    tournament_id       uuid        not null references public.hosted_tournaments(id) on delete cascade,
    group_id            uuid        not null,
    team_id             uuid        not null,

    -- 조 안에서의 '최종 순위'(절대값). 2·3위 동률이면 2, 3 이 들어간다.
    --   ⚠ 클라이언트가 보내지 않는다. 서버가 tie group 시작 rank + 입력 순서로 계산한다.
    resolved_order      integer     not null check (resolved_order >= 1),

    -- 운영 사유. 예: '합산연령 현장 확인'
    reason              text        not null check (length(btrim(reason)) between 2 and 200),
    -- 확정 당시 그 조의 완료 결과 지문. 사후 교차 검증용.
    source_fingerprint  text,

    resolved_by         uuid        references auth.users(id) on delete set null,
    resolved_at         timestamptz not null default now(),

    -- 무효화. 행을 지우지 않는다(이력 보존).
    invalidated_at      timestamptz,
    invalidated_reason  text,

    created_at          timestamptz not null default now(),

    constraint hosted_ttie_group_fk foreign key (tournament_id, group_id)
        references public.hosted_tournament_groups (tournament_id, id) on delete cascade,
    constraint hosted_ttie_team_fk  foreign key (tournament_id, team_id)
        references public.hosted_tournament_teams  (tournament_id, id) on delete cascade
);

comment on table public.hosted_tournament_group_tie_resolutions is
    '승률·득실 동률 시 운영진이 확정한 순서. ⚠ DOB/나이/합산연령 값을 저장하지 않는다.';
comment on column public.hosted_tournament_group_tie_resolutions.resolved_order is
    '조 내 최종 순위(절대값). 서버가 tie group 시작 rank 로부터 계산한다.';

-- 유효한 확정만 유일하다. 무효화된 행은 제약에서 빠져 재확정이 자유롭다.
create unique index if not exists hosted_ttie_active_team_uniq
    on public.hosted_tournament_group_tie_resolutions (group_id, team_id)
    where invalidated_at is null;
create unique index if not exists hosted_ttie_active_order_uniq
    on public.hosted_tournament_group_tie_resolutions (group_id, resolved_order)
    where invalidated_at is null;
create index if not exists hosted_ttie_group_idx
    on public.hosted_tournament_group_tie_resolutions (tournament_id, group_id);


-- ── 2. 권한 ─────────────────────────────────────────────────────────────────
alter table public.hosted_tournament_group_tie_resolutions enable row level security;

revoke all on table public.hosted_tournament_group_tie_resolutions
    from public, anon, authenticated;
grant  select on table public.hosted_tournament_group_tie_resolutions to authenticated;

drop policy if exists hosted_ttie_select_manager
    on public.hosted_tournament_group_tie_resolutions;
create policy hosted_ttie_select_manager
    on public.hosted_tournament_group_tie_resolutions
    for select to authenticated using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로가 존재하지 않는다.


-- ── 3. 내부 helper: 조 결과 지문 ────────────────────────────────────────────
--   그 조의 COMPLETED 경기 결과만으로 만든 지문. 운영자가 본 순위가 그대로인지 판정한다.
--   ⚠ 별도 version 컬럼을 두지 않고 이 지문으로 동시성을 본다(3A fingerprint 와 같은 방식).
create or replace function public.hosted_tournament_group_results_fingerprint(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select md5(coalesce(string_agg(
               m.id::text || ':' || m.score1::text || ':' || m.score2::text,
               '|' order by m.id), ''))
      from public.hosted_tournament_matches m
     where m.group_id = p_group_id
       and m.stage = 'preliminary'
       and m.status = 'completed';
$$;

revoke execute on function public.hosted_tournament_group_results_fingerprint(uuid) from public;
revoke execute on function public.hosted_tournament_group_results_fingerprint(uuid) from anon;
revoke execute on function public.hosted_tournament_group_results_fingerprint(uuid) from authenticated;


-- ── 4. RPC: 예선 순위 조회 ──────────────────────────────────────────────────
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


-- ── 5. RPC: 합산연령 동률 순서 확정 ─────────────────────────────────────────
--   ⚠ 운영진이 현장에서 합산연령을 확인한 뒤 '순서'만 넣는다. 나이 값을 받지 않는다.
--   ⚠ resolved_order 는 서버가 계산한다(tie group 시작 rank + 입력 순서).
--       1,2,2 → 2위 tie 확정 시 2,3
--       1,1,3 → 1위 tie 확정 시 1,2
--       1,1,1 → 전체 tie 확정 시 1,2,3
--   ⚠ groupComplete 가 아니면 거부한다. 사라질 동률을 확정하는 사고를 막는다.
create or replace function public.resolve_group_age_tie(
    p_slug                 text,
    p_group_no             integer,
    p_ordered_team_ids     uuid[],
    p_reason               text,
    p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_gid       uuid;
    v_gtype     text;
    v_reason    text;
    v_fp        text;
    v_generated integer;
    v_completed integer;
    v_n         integer;
    v_tie_rank  integer;
    v_tie_size  integer;
    v_inval     integer := 0;
    v_team_nos  integer[];
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    if p_ordered_team_ids is null or array_length(p_ordered_team_ids, 1) is null then
        return jsonb_build_object('ok', false, 'reason', 'empty_team_list');
    end if;
    v_n := array_length(p_ordered_team_ids, 1);
    if v_n <> (select count(distinct x) from unnest(p_ordered_team_ids) as x) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_team_in_list');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    -- ⚠ 경기 결과에서 파생되는 값이므로 matches 네임스페이스를 그대로 쓴다.
    --   amend 와 같은 락이라 결과 수정과 순위 확정이 서로를 기다린다(데드락 없음).
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    select id, group_type into v_gid, v_gtype
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_group_no;
    if v_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;
    if v_gtype <> 'preliminary' then
        return jsonb_build_object('ok', false, 'reason', 'placement_not_rankable');
    end if;

    -- 조가 완료되지 않았으면 확정하지 않는다(CANCELLED 가 있으면 여기서 걸린다).
    select count(*), count(*) filter (where status = 'completed')
      into v_generated, v_completed
      from public.hosted_tournament_matches
     where group_id = v_gid and stage = 'preliminary';
    if v_generated = 0 or v_completed <> v_generated then
        return jsonb_build_object('ok', false, 'reason', 'group_not_complete',
                                  'generated', v_generated, 'completed', v_completed);
    end if;

    -- 운영자가 본 결과가 그대로인지.
    v_fp := public.hosted_tournament_group_results_fingerprint(v_gid);
    if p_expected_fingerprint is null or p_expected_fingerprint <> v_fp then
        return jsonb_build_object('ok', false, 'reason', 'standings_changed',
                                  'fingerprint', v_fp);
    end if;

    -- 입력 팀 집합이 '실제로 탐지된 동률 묶음 하나'와 정확히 일치해야 한다.
    with sided as (
        select m.team1_id as team_id, m.score1 as gf, m.score2 as ga,
               (m.winner_team_id = m.team1_id) as won
          from public.hosted_tournament_matches m
         where m.group_id = v_gid and m.stage = 'preliminary' and m.status = 'completed'
        union all
        select m.team2_id, m.score2, m.score1, (m.winner_team_id = m.team2_id)
          from public.hosted_tournament_matches m
         where m.group_id = v_gid and m.stage = 'preliminary' and m.status = 'completed'
    ),
    agg as (
        select mm.team_id,
               count(s.team_id)              as played,
               count(*) filter (where s.won) as wins,
               coalesce(sum(s.gf), 0) - coalesce(sum(s.ga), 0) as game_diff
          from public.hosted_tournament_group_members mm
          left join sided s on s.team_id = mm.team_id
         where mm.group_id = v_gid
         group by mm.team_id
    ),
    ranked as (
        select a.team_id,
               rank() over (order by (a.wins::numeric / nullif(a.played, 0)) desc nulls last,
                                     a.game_diff desc) as auto_rank
          from agg a
    ),
    tie as (
        select auto_rank, count(*) as tsize, array_agg(team_id) as ids
          from ranked group by auto_rank having count(*) > 1
    )
    select t.auto_rank, t.tsize into v_tie_rank, v_tie_size
      from tie t
     where t.ids <@ p_ordered_team_ids and p_ordered_team_ids <@ t.ids;

    if v_tie_rank is null then
        return jsonb_build_object('ok', false, 'reason', 'tie_set_mismatch');
    end if;

    -- 기존 확정은 지우지 않고 무효화한다(이력 보존).
    update public.hosted_tournament_group_tie_resolutions
       set invalidated_at = now(), invalidated_reason = 're_resolved'
     where group_id = v_gid and invalidated_at is null
       and team_id = any(p_ordered_team_ids);
    get diagnostics v_inval = row_count;

    -- resolved_order = tie group 시작 rank + (입력 순서 - 1)
    insert into public.hosted_tournament_group_tie_resolutions
        (tournament_id, group_id, team_id, resolved_order, reason,
         source_fingerprint, resolved_by)
    select v_tid, v_gid, u.tid, v_tie_rank + (u.ord - 1)::integer, v_reason, v_fp, auth.uid()
      from unnest(p_ordered_team_ids) with ordinality as u(tid, ord);

    select array_agg(t.team_no order by r.resolved_order) into v_team_nos
      from public.hosted_tournament_group_tie_resolutions r
      join public.hosted_tournament_teams t on t.id = r.team_id
     where r.group_id = v_gid and r.invalidated_at is null;

    -- ⚠ 운영 식별자만 기록한다. 나이·합산연령·선수명을 남기지 않는다.
    perform public.hosted_tournament_log_event(
        v_tid, 'group', v_gid, 'group_age_tie_resolved', null,
        jsonb_build_object('groupNo', p_group_no, 'tieRank', v_tie_rank,
                           'tieSize', v_tie_size, 'orderedTeamNos', v_team_nos,
                           'replacedResolutions', v_inval,
                           'sourceFingerprint', v_fp), v_reason);

    return jsonb_build_object('ok', true, 'groupNo', p_group_no,
                              'tieRank', v_tie_rank, 'tieSize', v_tie_size,
                              'replacedResolutions', v_inval,
                              'fingerprint', v_fp);
end;
$$;

revoke execute on function public.resolve_group_age_tie(text,integer,uuid[],text,text) from public;
revoke execute on function public.resolve_group_age_tie(text,integer,uuid[],text,text) from anon;
grant  execute on function public.resolve_group_age_tie(text,integer,uuid[],text,text) to authenticated;


-- ── 6. amend_completed_match_score 교체 — 동률 확정 원자적 무효화 ───────────
--   ⚠⚠ create or replace 이므로 Supabase 기본 권한이 되살아난다.
--     같은 트랜잭션에서 revoke/grant 를 다시 적용한다.
--
--   변경점: 점수 수정 성공 시 같은 조의 유효한 동률 확정을 전부 무효화한다.
--     보수적으로 전부 무효화한다 — 점수가 바뀌면 승률·득실·동률 구조가 달라질 수 있고,
--     '동률이 유지되는지 재판정해서 유지'하는 쪽은 틀렸을 때 잘못된 순위가 조용히 남는다.
--   ⚠ 삭제하지 않는다. invalidated_at 으로 남긴다.
create or replace function public.amend_completed_match_score(
    p_match_id         uuid,
    p_score1           integer,
    p_score2           integer,
    p_reason           text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin  jsonb;
    v_tid    uuid;
    v_status text;
    v_reason text;
    v_before jsonb;
    v_t1     uuid;
    v_t2     uuid;
    v_gid    uuid;
    v_gno    integer;
    v_winner uuid;
    v_rows   integer;
    v_version integer;
    v_no     integer;
    v_inval  integer := 0;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    if p_score1 is null or p_score2 is null
       or greatest(p_score1, p_score2) <> 6
       or least(p_score1, p_score2) < 0
       or least(p_score1, p_score2) > 5 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_score');
    end if;

    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    if v_status <> 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'match_not_completed', 'status', v_status);
    end if;

    select team1_id, team2_id, match_no, group_id,
           jsonb_build_object('score1', score1, 'score2', score2,
                              'winnerTeamId', winner_team_id)
      into v_t1, v_t2, v_no, v_gid, v_before
      from public.hosted_tournament_matches where id = p_match_id;

    v_winner := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    update public.hosted_tournament_matches
       set score1 = p_score1, score2 = p_score2, winner_team_id = v_winner,
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'completed' and version = p_expected_version
    returning version into v_version;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- ★ 같은 트랜잭션에서 동률 확정 무효화. 클라이언트 후처리에 의존하지 않는다.
    if v_gid is not null then
        update public.hosted_tournament_group_tie_resolutions
           set invalidated_at = now(), invalidated_reason = 'score_amended'
         where group_id = v_gid and invalidated_at is null;
        get diagnostics v_inval = row_count;

        if v_inval > 0 then
            select group_no into v_gno
              from public.hosted_tournament_groups where id = v_gid;
            perform public.hosted_tournament_log_event(
                v_tid, 'group', v_gid, 'group_age_tie_resolution_invalidated', null,
                jsonb_build_object('groupNo', v_gno, 'invalidatedCount', v_inval,
                                   'cause', 'score_amended', 'matchNo', v_no), v_reason);
        end if;
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_score_amended', v_before,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version,
                           'invalidatedResolutions', v_inval), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'winnerTeamId', v_winner,
                              'invalidatedResolutions', v_inval);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) to authenticated;

commit;
