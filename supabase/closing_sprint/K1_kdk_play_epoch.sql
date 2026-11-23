-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT K1] KDK matches.play_epoch — 경기 "투입 주기" 구분(복귀 → 재투입 뒤 이전 점수 창 저장 차단)
--   ⚠ 운영 적용 전 사용자 승인 필요. 적용 전 K1_..._precheck_READONLY.sql, 적용 후 K1_..._verify_READONLY.sql.
--   배포 순서 · 롤백: docs/KDK_PLAY_EPOCH_RELEASE.md
--   검증: scripts/verify_kdk_play_epoch_concurrency.mjs — 로컬 테스트 전용 PostgreSQL(가상 데이터)에서 설치 · 재실행 ·
--         증가 규칙 · 위조 차단 · 동시 투입 · 이전 점수 창 차단 · P1 guard/SPOTLIGHT 호환 · 잠금 시간 제한 · 롤백.
--
-- 문제(afa598e P1 수정 이후 남은 경우)
--   화면은 점수 창을 연 시점의 status · 점수로 조건부 UPDATE 한다. 복귀(→waiting) 후 재투입(→playing)되면 status 가 다시
--   playing 이라, 복귀 전에 열어 둔 점수 창의 저장이 재투입된 경기의 결과로 들어간다(ABA).
--
-- 규칙
--   - play_epoch integer NOT NULL DEFAULT 0. 기존 행은 0(= 이 migration 이전 투입 또는 미투입). NULL 없음.
--   - status 가 playing 이 아닌 값 → playing 으로 바뀌는 UPDATE 마다 +1 (최초 투입 0→1, 복귀 후 재투입 1→2 …).
--     경로 무관: start_kdk_match(DEFINER RPC) · 직접 UPDATE · upsert 의 UPDATE 단계 모두 같은 BEFORE trigger.
--   - 그 외 UPDATE(점수 저장 · 정정 · 타이머 · 완료 · 복귀 · 되돌리기 · 메타 수정)는 값을 유지.
--   - INSERT: status 가 playing 이면 1, 아니면 0 으로 고정.
--   - 위조 차단: PostgREST 직접 쓰기(current_user = anon/authenticated)가 play_epoch 를 다른 값으로 보내면 42501.
--     DEFINER RPC · SQL Editor · service_role 은 오류 없이 규칙값으로 덮어쓴다.
--   - 동시 투입: 같은 행 UPDATE 는 행 잠금으로 직렬화되고 start_kdk_match 는 status='waiting' 전제이므로 증가는 투입 1회당 1번.
--
-- 바뀌지 않는 것: 기존 점수 · 승패 · 상태 데이터(UPDATE 0건) · start_kdk_match · 타이머 · 복귀 · P1 score guard · 원장 ·
--   SPOTLIGHT(xmin 인증 — 상수 DEFAULT 열 추가는 행을 다시 쓰지 않아 xmin 유지) · RLS · 권한 · Realtime publication.
--
-- trigger 순서(BEFORE, 이름순): kdk_p1_score_guard_trg('kdk_p1…') → kdk_play_epoch_trg('kdk_pl…').
--   guard 가 먼저 회원의 "최초 입력 외 열 불변"을 검사하므로 회원의 play_epoch 위조는 guard 에서도 거절된다.
--   이 trigger 는 BEFORE trigger 중 마지막이어야 한다(사전 점검 STOP).
--
-- 잠금: ALTER TABLE 은 matches 에 ACCESS EXCLUSIVE 잠금을 잠깐 잡는다(상수 DEFAULT → 테이블 재작성 없음 · 즉시).
--   진행 중 트랜잭션이 있으면 lock_timeout(3s) 후 실패 · 전체 취소(무변경). 재시도하면 된다.
-- 재실행: 안전(이미 적용돼 있으면 정의만 같은 내용으로 다시 만든다 · 데이터 변경 없음).
-- 롤백: K1_kdk_play_epoch_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $k1$
declare v_type text; v_notnull boolean; v_after text;
begin
  if to_regclass('public.matches') is null then
    raise exception 'STOP K1: public.matches 없음 — 변경 없음';
  end if;
  -- 같은 이름 열이 다른 정의로 있으면 STOP
  select data_type, is_nullable = 'NO' into v_type, v_notnull
    from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'play_epoch';
  if v_type is not null and (v_type <> 'integer' or not v_notnull) then
    raise exception 'STOP K1: matches.play_epoch 가 이미 다른 정의(%, not null=%)로 있음 — 변경 없음', v_type, v_notnull;
  end if;
  -- 이 trigger 보다 이름이 뒤인 BEFORE trigger 가 있으면(값을 다시 바꿀 수 있음) STOP
  select string_agg(tgname, ', ') into v_after
    from pg_trigger
   where tgrelid = 'public.matches'::regclass and not tgisinternal
     and (tgtype & 2) = 2                                   -- BEFORE
     and tgname > 'kdk_play_epoch_trg';
  if v_after is not null then
    raise exception 'STOP K1: kdk_play_epoch_trg 뒤에 실행되는 BEFORE trigger 가 있음(%) — 변경 없음', v_after;
  end if;
end
$k1$;

alter table public.matches add column if not exists play_epoch integer not null default 0;
comment on column public.matches.play_epoch is
  'KDK 투입 주기. status 가 playing 으로 들어갈 때마다 trigger(kdk_play_epoch_trg)가 +1. 0 = K1 적용 이전 투입 또는 미투입. 직접 변경 불가.';

create or replace function public.kdk_play_epoch_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_direct boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if v_direct and new.play_epoch is distinct from 0 then
      raise exception 'kdk: play_epoch 는 직접 지정할 수 없습니다' using errcode = '42501';
    end if;
    new.play_epoch := case when new.status = 'playing' then 1 else 0 end;
    return new;
  end if;
  -- UPDATE
  if v_direct and new.play_epoch is distinct from old.play_epoch then
    raise exception 'kdk: play_epoch 는 직접 변경할 수 없습니다' using errcode = '42501';
  end if;
  if new.status = 'playing' and old.status is distinct from 'playing' then
    new.play_epoch := coalesce(old.play_epoch, 0) + 1;
  else
    new.play_epoch := old.play_epoch;
  end if;
  return new;
end;
$$;
revoke all on function public.kdk_play_epoch_guard() from public, anon, authenticated;

drop trigger if exists kdk_play_epoch_trg on public.matches;
create trigger kdk_play_epoch_trg before insert or update on public.matches
  for each row execute function public.kdk_play_epoch_guard();

commit;

notify pgrst, 'reload schema';

select 'K1' as step,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'matches'
          and column_name = 'play_epoch' and data_type = 'integer' and is_nullable = 'NO') = 1 as column_ok,
       (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_play_epoch_trg' and tgenabled <> 'D') = 1 as trigger_on,
       (select count(*) from public.matches where play_epoch is null) as null_rows;      -- 0
