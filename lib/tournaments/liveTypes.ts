// LIVE Streaming 공용 타입 — 서버(API route)와 클라이언트(Player)가 함께 쓴다.
//
//   ⚠ 이 파일에는 secret 이 없다. 클라이언트 번들에 들어가도 안전한 타입/상수만 둔다.
//     Cloudflare API Token · RTMPS Stream Key · SRT passphrase 는
//     lib/tournaments/server/streamProvider.ts 밖으로 나가지 않는다.
//
//   ⚠ 영상 LIVE 상태와 대회 경기 상태(match status)는 별개 개념이다.
//     경기는 진행 중인데 영상이 끊길 수 있고, 그 반대도 가능하다.
//     여기 정의된 값들은 '영상 송출' 상태만 의미하며 Tournament 운영 로직에 영향을 주지 않는다.

/** 영상 송출 상태. Tournament match status(READY/PLAYING/COMPLETED)와 절대 합치지 않는다. */
export type LiveVideoState =
  /** 아직 한 번도 연결된 적 없음(송출 대기). */
  | 'offline'
  /** 설정 수락 직후 — 첫 프레임 도달 전. */
  | 'connecting'
  /** 송출 중. */
  | 'live'
  /** 끊겼고 Provider 가 재연결 시도 중. */
  | 'recovering'
  /** 송출자가 정상 종료했거나 세션 TTL 종료. */
  | 'ended'
  /** 연결 실패(코덱/네트워크 등) — Provider 가 실패로 보고한 상태. */
  | 'error'
  /**
   * Provider 조회 자체가 불가(미설정·API 오류·타임아웃).
   *   ⚠ 이것은 Provider 가 보고한 값이 아니라 TEYEON 쪽 판정이다. 둘을 섞지 않는다.
   */
  | 'unavailable';

/** 사용자에게 보여줄 한 줄 상태 문구. 없는 정보를 지어내지 않는다. */
export const LIVE_STATE_LABEL: Record<LiveVideoState, string> = {
  offline: 'OFFLINE',
  connecting: 'CONNECTING',
  live: 'LIVE',
  recovering: 'RECOVERING',
  ended: 'ENDED',
  error: 'ERROR',
  unavailable: 'UNAVAILABLE',
};

/** Player 영역에 띄울 안내. Tournament 정보는 이 문구와 무관하게 계속 보여야 한다. */
export const LIVE_STATE_NOTE: Record<LiveVideoState, string> = {
  offline: '현장 LIVE 연결을 준비하고 있습니다.',
  connecting: '현장 LIVE 연결을 시작하고 있습니다.',
  live: '',
  recovering: '현장 네트워크 상태로 인해 LIVE 연결을 복구하고 있습니다.',
  ended: 'LIVE 송출이 종료되었습니다.',
  error: '현장 LIVE 연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  unavailable: 'LIVE Provider가 아직 연결되지 않았습니다.',
};

/** 종료 후 생성된 다시보기(Provider recording). */
export interface LiveReplay {
  /** Provider video UID — 재생 전용 식별자(secret 아님). */
  id: string;
  /** 초 단위. Provider 가 주지 않으면 null. */
  durationSec: number | null;
  /** ISO8601. Provider 가 주지 않으면 null. */
  createdAt: string | null;
  /** iframe 재생 URL. */
  playbackUrl: string;
}

/**
 * 관리자가 확정한 경기별 다시보기(녹화의 한 구간).
 *   ⚠ 공개 RPC get_public_live_replays 가 확정 · DRAW 공개 조건을 적용한 값만 담는다.
 *   ⚠ Cloudflare 플레이어는 시작 위치(startTime)만 지원한다 — 끝 위치에서 자동으로 멈추지 않는다.
 */
export interface LiveMatchReplay {
  videoUid: string;
  /** 녹화 시작 기준 초(관리자 보정값이 있으면 그 값). */
  startSec: number;
  endSec: number;
  /** 구간 시작 시각(ISO). 없으면 null. */
  recordedAt: string | null;
  title: string | null;
  match: LiveMatchInfo;
  /** 이 녹화의 iframe 재생 URL(쿼리 없음). Provider 미설정이면 null. */
  playbackUrl: string | null;
}

/** 지금 중계 경기의 한 팀(선수 두 명). */
export interface LiveMatchTeam {
  player1Name: string;
  player2Name: string;
}

/**
 * 지금 중계 경기(공개 RPC get_public_live_match 의 결과를 화이트리스트로 다시 담은 값).
 *   ⚠ 내부 ID · 점수 · 팀 번호 · 연락처는 담지 않는다.
 *   ⚠ 영상 상태(LiveVideoState)와 별개다 — 경기 정보가 없어도 영상은 재생된다.
 */
export interface LiveMatchInfo {
  stage: 'preliminary' | 'placement' | 'knockout';
  /** '예선 3조' · '순위결정전 19' · '8강' 처럼 화면에 그대로 쓰는 단계 이름. */
  stageLabel: string;
  matchNo: number | null;
  courtNo: number | null;
  courtName: string | null;
  team1: LiveMatchTeam;
  team2: LiveMatchTeam;
}

/** 경기 정보 조회 결과. available=false 는 '조회 실패 · 미지원' — 화면은 경기 정보 칸만 숨긴다. */
export interface LiveMatchState {
  available: boolean;
  /** auto = LIVE 중계 코트 자동 · manual = 관리자 고정 · none = 관리자가 '중계 경기 없음' 지정. */
  mode: 'auto' | 'manual' | 'none' | null;
  /** 지금 보여 줄 경기. null = 중계 코트에 진행 경기 없음 또는 DRAW 비공개. */
  match: LiveMatchInfo | null;
}

/** 시청 화면의 영상 소스. 기본 YouTube · 백업 Cloudflare. ⚠ 실제 송출 주소 전환은 현장 송출 앱에서 따로 한다. */
export type LiveSourceKind = 'youtube' | 'cloudflare';

/** YouTube 방송 상태(Data API 키가 있을 때만 안다). null = 모름 — 지어내지 않는다. */
export type YouTubeBroadcastStatus = 'upcoming' | 'live' | 'ended' | 'none';

/**
 * 영상 소스 설정(공개 값만). ⚠ video ID 는 공개 시청 식별자 — 스트림 키 · 토큰은 담지 않는다.
 *   origin: db = 운영진 설정(SQL 적용 후) · env = 서버 환경변수(SQL 미적용 · 비상용) · default = 아무 설정 없음.
 */
export interface LiveSourceInfo {
  source: LiveSourceKind;
  youtubeVideoId: string | null;
  youtubeReplayVideoId: string | null;
  origin: 'db' | 'env' | 'default';
  youtubeStatus: YouTubeBroadcastStatus | null;
}

/** /api/tournaments/[slug]/live 응답. ⚠ streamKey·API token 을 절대 포함하지 않는다. */
export interface LivePayload {
  /** Provider 환경변수가 모두 갖춰졌는지. false 면 화면은 safe empty state 를 보여준다. */
  configured: boolean;
  state: LiveVideoState;
  /**
   * Provider 가 보고한 원문 상태 문자열(Cloudflare: connected / reconnecting / client_disconnect …).
   *   ⚠ 가공하지 않는다. 조회 실패 시 null. HEALTHY 같은 값을 만들어내지 않는다.
   */
  providerStatus: string | null;
  /**
   * Provider 실측 동시 시청자 수.
   *   ⚠ 페이지 조회 수가 아니다. 조회 불가 시 null 이며, 0 으로 대체하지 않는다.
   */
  viewers: number | null;
  /** Cloudflare Stream Player iframe URL. 미설정/조회 실패 시 null. */
  playbackUrl: string | null;
  /** 종료된 방송의 다시보기 목록(최신순). */
  replays: LiveReplay[];
  /** 이 응답을 만든 시각(ISO). */
  fetchedAt: string;
  /**
   * 지금 중계 경기 정보. 영상 Provider 와 독립적으로 조회한다(실패해도 영상 상태 · 재생에 영향 없음).
   *   이전 버전 응답에는 없을 수 있다.
   */
  liveMatch?: LiveMatchState;
  /** 관리자가 확정한 경기별 다시보기. 조회 실패 · 미지원이면 빈 배열(이전 버전 응답에는 없을 수 있다). */
  matchReplays?: LiveMatchReplay[];
  /** 영상 소스(YouTube 기본 · Cloudflare 백업). 이전 버전 응답에는 없다 → 화면은 Cloudflare 로 본다. */
  source?: LiveSourceInfo;
}

/**
 * 폴링 간격.
 *   Provider API 를 과도하게 때리지 않으면서 상태 전환을 놓치지 않는 값.
 *   서버 쪽에도 짧은 TTL 캐시가 있어 시청자가 늘어도 Provider 호출량은 일정하게 유지된다.
 */
export const LIVE_POLL_MS = 20_000;
