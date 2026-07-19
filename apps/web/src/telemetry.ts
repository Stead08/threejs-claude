// クライアントテレメトリー（apps/web 専用）。実機（iOS Safari 等）で
// 「タップしても読み込み中のまま進まない」を遠隔診断するため、起動フローの
// 段階マーク（ブレッドクラム）・エラー・スタック検知を POST /api/telemetry へ送り、
// Cloudflare Worker（src/worker.ts）経由で Workers Logs に構造化ログとして残す。
// 記録・送信の失敗はゲーム進行へ影響させない（すべて握りつぶす）。

/** 送信先。src/worker.ts と wrangler.jsonc の run_worker_first: ["/api/*"] に一致させること。 */
const ENDPOINT = "/api/telemetry";
/** ブレッドクラム保持上限。超えたら古いものから捨てる。 */
const MAX_BREADCRUMBS = 80;
/** 1 ページセッションあたりの送信上限（エラーループでの送信スパム防止）。 */
const MAX_REPORTS = 20;
/** タップからこの時間内に play へ到達（または失敗確定）しなければ load-stuck を送る。 */
const STUCK_TIMEOUT_MS = 30_000;

interface Breadcrumb {
  /** ページロード起点の経過ミリ秒（整数）。 */
  t: number;
  name: string;
  data?: Record<string, unknown>;
}

/** ページセッション識別子。同一端末のリトライを Logs 上で紐付ける。 */
const sessionId = Math.random().toString(36).slice(2, 10);
const breadcrumbs: Breadcrumb[] = [];
let reportCount = 0;
let watchdogId: ReturnType<typeof setTimeout> | null = null;

function nowMs(): number {
  return Math.round(performance.now());
}

/** 起動フローの段階マークを記録する。Logs へは次回 report 時にまとめて載る。 */
export function mark(name: string, data?: Record<string, unknown>): void {
  breadcrumbs.push(data === undefined ? { t: nowMs(), name } : { t: nowMs(), name, data });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
  console.debug(`[telemetry] ${name}`, data ?? "");
}

/** イベント + 全ブレッドクラムを Workers Logs へ送る。 */
export function report(event: string, data?: Record<string, unknown>): void {
  if (reportCount >= MAX_REPORTS) {
    return;
  }
  reportCount += 1;
  const payload = JSON.stringify({
    event,
    sessionId,
    t: nowMs(),
    href: location.href,
    ua: navigator.userAgent,
    data: data ?? null,
    breadcrumbs,
  });
  try {
    // sendBeacon はページ離脱中でも送達が期待できる。使えない環境は fetch keepalive へ。
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, payload)) {
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // 受け口が無い環境（vite dev 等）では送れなくてよい。
    });
  } catch {
    // テレメトリー起因でゲームを壊さない。
  }
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: (err.stack ?? "").slice(0, 4000) };
  }
  return { value: String(err) };
}

/** エラーイベントを送る（起動失敗・グローバルエラー用）。 */
export function reportError(event: string, err: unknown, data?: Record<string, unknown>): void {
  report(event, { ...data, error: serializeError(err) });
}

/**
 * ロード監視を開始する。STUCK_TIMEOUT_MS 内に disarm されなければ、
 * snapshot()（appState / 進捗 / AudioContext state 等）付きで load-stuck を送る。
 */
export function armLoadWatchdog(snapshot: () => Record<string, unknown>): void {
  disarmLoadWatchdog();
  watchdogId = setTimeout(() => {
    watchdogId = null;
    report("load-stuck", { timeoutMs: STUCK_TIMEOUT_MS, ...snapshot() });
  }, STUCK_TIMEOUT_MS);
}

/** ロード監視を解除する（play 到達・失敗確定時）。 */
export function disarmLoadWatchdog(): void {
  if (watchdogId !== null) {
    clearTimeout(watchdogId);
    watchdogId = null;
  }
}

/** グローバルエラー捕捉を設置する。モジュール読み込み直後に 1 回だけ呼ぶ。 */
export function initTelemetry(): void {
  window.addEventListener("error", (e: ErrorEvent): void => {
    reportError("window-error", e.error ?? e.message, {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent): void => {
    reportError("unhandled-rejection", e.reason);
  });
  mark("boot");
}
