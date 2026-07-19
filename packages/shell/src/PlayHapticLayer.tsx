// プレイ中の iOS 用ハプティクスレイヤ。画面全体を透明スイッチで覆い、タップごとに
// ネイティブハプティックを鳴らす。pointerdown はスイッチから window までバブリングする
// ため、window で購読するゲーム入力（InputQueue）はこのレイヤ越しでも欠落しない。
// Vibration API 対応環境（Android 等）はゲーム側の onTap で振動させるため何も描画しない。

import type { ReactElement } from "react";
import { detectHapticsMode } from "@rhythm/engine";
import { HapticSwitch } from "./HapticSwitch";

const mode = detectHapticsMode();

export function PlayHapticLayer(): ReactElement | null {
  if (mode !== "ios-switch") {
    return null;
  }
  return <HapticSwitch style={{ position: "fixed", inset: 0 }} />;
}
