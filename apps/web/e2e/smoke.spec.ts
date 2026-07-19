// スモークテスト（M0-SPEC §9）。タイトル→タップ→ローディング→プレイ到達までの状態遷移を検証する。
// 統合フェーズ（wasm ビルド・games/metronome 実装後）で実行される想定。ここでは実行しない。
//
// 注記: プレイ到達判定に使う「fps」ラベルは M0-SPEC §7（games/metronome のデバッグ HUD）が定める
// 表示項目に基づく best-effort な文言一致。games/metronome の実際の HUD 実装で文言が変わる場合は
// 本ファイルのセレクタを合わせて調整すること。

import { expect, test } from "@playwright/test";

// CI でのみ再現する失敗の診断用: ブラウザコンソールとページエラーを収集し、
// 失敗時に stdout（CI ログ）へ出力する。トレースはアーティファクト経由でしか
// 見られないため、ログだけで一次切り分けできるようにしておく。
const MAX_CAPTURED_LOGS = 100;

test.describe("metronome smoke", () => {
  const captured: string[] = [];

  test.beforeEach(({ page }) => {
    captured.length = 0;
    page.on("console", (msg) => {
      if (captured.length < MAX_CAPTURED_LOGS) {
        captured.push(`[console.${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      if (captured.length < MAX_CAPTURED_LOGS) {
        captured.push(`[pageerror] ${err.stack ?? err.message}`);
      }
    });
  });

  test.afterEach(() => {
    const info = test.info();
    if (info.status === info.expectedStatus) {
      return;
    }
    console.log(`--- browser logs (${captured.length}) ---`);
    for (const line of captured) {
      console.log(line);
    }
  });

  test("タイトル → タップ → ローディング → プレイに到達する", async ({ page }) => {
    await page.goto("/");

    // タイトル画面: ロゴ文字と「タップではじめる」が見える（画面全体がボタン）。
    await expect(page.getByText("カラテや")).toBeVisible();
    const startButton = page.getByText("タップではじめる");
    await expect(startButton).toBeVisible();

    // タップで開始（AudioContext unlock → ロード開始）。
    await startButton.tap();

    // タイトルの「タップではじめる」表示は消える（ローディングまたはプレイへ遷移済み）。
    await expect(page.getByText("タップではじめる")).toHaveCount(0);

    // ローディング画面: 進捗バー（role=progressbar）が一度は出現する。
    // 曲レンダは wasm 側で完了するため一瞬で終わる可能性もあるが、出現していた形跡
    // （もしくは既にプレイへ抜けている）のどちらでも後続のプレイ到達判定で担保する。
    const loadingBar = page.getByRole("progressbar");
    // timeout を明示しないと既定の長い待ちがそのまま適用され、「高速完了時は無視」の
    // 意図（catch）が機能しない。短い timeout で待ち、出なければ次段階の判定へ進む。
    await loadingBar.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {
      // 非常に高速に完了した場合は見えないまま次段階へ進んでいるため無視する。
    });

    // プレイ到達: canvas が可視 かつ ゲーム側 HUD（DOM 直更新）に fps 表示が出現する。
    const canvas = page.locator("canvas#game");
    await expect(canvas).toBeVisible();
    await expect(page.getByText(/fps/i)).toBeVisible({ timeout: 60_000 });

    // プレイ中は React シェルのタイトル/ローディング/リザルト画面が一切出ていないこと。
    await expect(page.getByText("タップではじめる")).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  });
});
