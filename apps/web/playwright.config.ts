// apps/web の Playwright 設定（M0-SPEC §9）。モバイルビューポート単一プロジェクトで smoke を通す。

import { defineConfig, devices } from "@playwright/test";

const PREVIEW_PORT = 4173;

/**
 * process.env を読む。apps/web は @types/node に依存しない構成のため（ルートで未導入・追加不可）、
 * グローバル `process` を直接参照せず globalThis 経由の構造的キャストで安全に読む。
 */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

const isCI = (readEnv("CI") ?? "") !== "";

/**
 * ローカル(サンドボックス)にはプリインストール Chromium がある(PLAYWRIGHT_BROWSERS_PATH 配下の
 * `chromium` シンボリックリンク)。Playwright が期待するビルド番号と一致しない場合でも動かせるよう、
 * CI 以外では executablePath で直接指定する。CI では playwright install した通常ブラウザを使う。
 */
const browsersPath = readEnv("PLAYWRIGHT_BROWSERS_PATH");
const localChromium = !isCI && browsersPath ? `${browsersPath}/chromium` : undefined;

export default defineConfig({
  testDir: "e2e",
  // ロード（オフラインシンセレンダ）を含む起動フローのため長めに取る。
  timeout: 60_000,
  // 既定の expect timeout はテスト全体(60s)より短くし、長い待ちが必要な箇所
  // (プレイ到達判定)はアサーション側で個別に timeout を指定する。
  expect: {
    timeout: 30_000,
  },
  fullyParallel: true,
  retries: isCI ? 1 : 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm preview",
    port: PREVIEW_PORT,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
