// Cloudflare Worker エントリ。/api/telemetry で受けたクライアントテレメトリーを
// Workers Logs へ構造化ログとして出力する（wrangler.jsonc の observability.enabled で
// 7 日間保存され、ダッシュボードの Workers > threejs-claude > Logs か `wrangler tail` で
// 検索・閲覧できる）。それ以外のリクエストは静的アセット配信（SPA フォールバック込み）へ
// 委譲する。クライアント側の送信元は src/telemetry.ts。

/** assets binding の最小型（@cloudflare/workers-types 非導入のためローカル定義）。 */
interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

/** 受け付ける最大ボディバイト数（Workers Logs の 1 ログ 256KB 制限に収める）。 */
const MAX_BODY_BYTES = 64 * 1024;

/** イベント名にこれらを含むログは console.error で出す（Logs 上で error レベルとして絞り込める）。 */
const ERROR_EVENT_MARKERS = ["error", "stuck", "fail", "rejection"];

async function handleTelemetry(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const record = {
    source: "client-telemetry",
    // 地域・端末の切り分け用（IP そのものは記録しない）。
    country: request.headers.get("cf-ipcountry"),
    payload,
  };
  const event =
    typeof payload === "object" && payload !== null && "event" in payload
      ? String((payload as { event: unknown }).event)
      : "";
  if (ERROR_EVENT_MARKERS.some((marker) => event.includes(marker))) {
    console.error(record);
  } else {
    console.log(record);
  }
  return new Response(null, { status: 204 });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/telemetry") {
      return handleTelemetry(request);
    }
    return env.ASSETS.fetch(request);
  },
};
