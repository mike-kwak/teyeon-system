// MATCH SPOTLIGHT AI 초안 — 서버 AI 계층(의존성 주입 · 외부 API 미연결).
//
//   ⚠ 이 파일은 실제 AI 공급자를 호출하지 않는다. 공급자 어댑터는 P3(키 · 비용 · 개인정보 검토 승인 후)에 추가한다.
//     설정이 모두 갖춰져도 어댑터가 없으면 available=false(provider_not_connected) → 편집기는 수동 작성 모드.
//   설정(서버 전용 env · NEXT_PUBLIC_ 아님):
//     SPOTLIGHT_AI_ENABLED=1          기능 스위치(기본 꺼짐)
//     SPOTLIGHT_AI_PROVIDER=anthropic 공급자(어댑터가 있어야 함)
//     SPOTLIGHT_AI_MODEL=<모델 id>    모델(코드에 고정하지 않음 — 품질 · 비용 · 속도 비교 후 지정)
//     ANTHROPIC_API_KEY               공급자 키(응답 · 로그에 절대 넣지 않음)
//     SPOTLIGHT_AI_TIMEOUT_MS         5000~30000(기본 20000)
//   호출 제한(createMemoryAiLimiter)은 인스턴스 메모리 기반 "최선 노력"이다 — 서버리스는 인스턴스가 여러 개라
//   전역 한도를 보장하지 못한다. Production 활성화 전 DB 기반 한도(별도 SQL 승인)가 필요하다.

export interface AiGenerateRequest { system: string; user: string; maxOutputTokens: number }
/** 공급자 어댑터: 원문 응답(문자열 또는 JSON 객체)을 돌려준다. signal 로 중단 가능해야 한다. */
export type AiGenerate = (req: AiGenerateRequest, signal: AbortSignal) => Promise<unknown>;

export type AiUnavailableReason = 'disabled' | 'no_model' | 'no_key' | 'provider_not_connected';

export interface SpotlightAiConfig {
  enabled: boolean;
  provider: string;
  model: string;
  hasKey: boolean;
  timeoutMs: number;
}

export function readSpotlightAiConfig(env: Record<string, string | undefined>): SpotlightAiConfig {
  const t = Number(env.SPOTLIGHT_AI_TIMEOUT_MS);
  return {
    enabled: env.SPOTLIGHT_AI_ENABLED === '1',
    provider: String(env.SPOTLIGHT_AI_PROVIDER || 'anthropic').trim().toLowerCase(),
    model: String(env.SPOTLIGHT_AI_MODEL || '').trim(),
    hasKey: !!String(env.ANTHROPIC_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(t) && t > 0 ? Math.min(30000, Math.max(5000, Math.trunc(t))) : 20000,
  };
}

/** 공급자 어댑터 목록 — P3 전까지 비어 있다(실제 외부 호출 없음). */
const ADAPTERS: Record<string, ((cfg: SpotlightAiConfig) => AiGenerate) | undefined> = {};

export function availabilityOf(cfg: SpotlightAiConfig, adapters = ADAPTERS): { available: true } | { available: false; reason: AiUnavailableReason } {
  if (!cfg.enabled) return { available: false, reason: 'disabled' };
  if (!cfg.model) return { available: false, reason: 'no_model' };
  if (!cfg.hasKey) return { available: false, reason: 'no_key' };
  if (!adapters[cfg.provider]) return { available: false, reason: 'provider_not_connected' };
  return { available: true };
}

export function adapterFor(cfg: SpotlightAiConfig, adapters = ADAPTERS): AiGenerate | null {
  const a = availabilityOf(cfg, adapters);
  return a.available ? (adapters[cfg.provider] as (c: SpotlightAiConfig) => AiGenerate)(cfg) : null;
}

/** 시간 제한 실행 — 초과 시 'ai_timeout' 오류. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ac.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error('ai_timeout')); }, ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

// ── 호출 제한(최선 노력 · 인스턴스 메모리) ───────────────────────────────────────
export interface AiLimitPolicy {
  perUserWindowMs: number; perUserMax: number;   // 사용자별 요청 수(창)
  perRunMax: number;                              // 회차별 생성 경기 수 합계
  perMatchRegenerateMax: number;                  // 경기별 재생성 횟수
}
export const DEFAULT_AI_LIMITS: AiLimitPolicy = { perUserWindowMs: 10 * 60 * 1000, perUserMax: 12, perRunMax: 60, perMatchRegenerateMax: 5 };

export type AiLimitDeny = 'ai_busy' | 'ai_rate_limited' | 'ai_run_limit' | 'ai_regenerate_limit';
export interface AiLimiter {
  /** 허용이면 release 함수(요청 종료 시 호출), 거부면 사유. */
  acquire(userId: string, runId: string, matchNos: readonly number[], regenerate: boolean): { ok: true; release: () => void } | { ok: false; reason: AiLimitDeny; matchNo?: number };
}

export function createMemoryAiLimiter(policy: AiLimitPolicy = DEFAULT_AI_LIMITS, now: () => number = Date.now): AiLimiter {
  const inflight = new Set<string>();
  const userHits = new Map<string, number[]>();
  const runCount = new Map<string, number>();
  const regen = new Map<string, number>();
  return {
    acquire(userId, runId, matchNos, regenerate) {
      if (inflight.has(userId)) return { ok: false, reason: 'ai_busy' };
      const t = now();
      const hits = (userHits.get(userId) || []).filter((x) => t - x < policy.perUserWindowMs);
      if (hits.length >= policy.perUserMax) return { ok: false, reason: 'ai_rate_limited' };
      if ((runCount.get(runId) || 0) + matchNos.length > policy.perRunMax) return { ok: false, reason: 'ai_run_limit' };
      // 경기별 생성 횟수는 클라이언트의 regenerate 표시를 믿지 않고 서버가 직접 센다(최초 1회 + 재생성 N회).
      //   regenerate 는 사유 표시용일 뿐 — false 로 보내도 한도를 우회할 수 없다.
      void regenerate;
      for (const no of matchNos) if ((regen.get(`${runId}:${no}`) || 0) >= policy.perMatchRegenerateMax + 1) return { ok: false, reason: 'ai_regenerate_limit', matchNo: no };
      hits.push(t); userHits.set(userId, hits);
      runCount.set(runId, (runCount.get(runId) || 0) + matchNos.length);
      for (const no of matchNos) regen.set(`${runId}:${no}`, (regen.get(`${runId}:${no}`) || 0) + 1);
      inflight.add(userId);
      let done = false;
      return { ok: true, release: () => { if (!done) { done = true; inflight.delete(userId); } } };
    },
  };
}

/** 핸들러에 주입하는 AI 의존성. 없거나 available=false 면 수동 모드. */
export interface SpotlightAiDeps {
  available: boolean;
  reason?: AiUnavailableReason;
  timeoutMs: number;
  generate: AiGenerate | null;
  limiter: AiLimiter;
}

export function createSpotlightAiDeps(env: Record<string, string | undefined>, limiter: AiLimiter): SpotlightAiDeps {
  const cfg = readSpotlightAiConfig(env);
  const a = availabilityOf(cfg);
  return { available: a.available, reason: a.available ? undefined : a.reason, timeoutMs: cfg.timeoutMs, generate: adapterFor(cfg), limiter };
}
