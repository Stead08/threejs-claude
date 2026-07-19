// チュートリアル画面（「あそびかた」オーバレイ）。SettingsScreen と同じ構造で zIndex は一段上の 31。
// inline style では @keyframes を書けないため、rhythm-tutorial- プレフィックスのクラス名で
// <style> 要素をコンポーネント内に 1 つだけ埋め込む（他画面とのクラス名衝突を回避）。

import type { ReactElement } from "react";
import { theme } from "../theme";
import { useShellStore } from "../store";
import { HapticButton } from "../HapticButton";
import { uiConfirmSound } from "../ui-sfx";

/** チュートリアル既読フラグの localStorage キー。 */
export const TUTORIAL_SEEN_KEY = "rhythm.tutorialSeen.v1";

/** 既読フラグを保存する（localStorage 不可環境では黙って諦める）。 */
function markTutorialSeen(): void {
  try {
    globalThis.localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } catch {
    // Cookie ブロック環境等ではアクセス自体が throw するため握りつぶす。
  }
}

// ミニデモ: 玉が奥（上方・小さく）からリングへ近づき、重なった瞬間にリングが光る。
// 両アニメーションは同一 duration の infinite で同期させる。
const DEMO_CSS = `
@keyframes rhythm-tutorial-ball {
  0%   { transform: translate(-50%, -80px) scale(0.25); opacity: 0.35; }
  58%  { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  74%  { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
}
@keyframes rhythm-tutorial-ring {
  0%, 54%   { border-color: ${theme.accentDim}; box-shadow: none; }
  60%, 74%  { border-color: ${theme.accent}; box-shadow: 0 0 24px ${theme.accent}; }
  86%, 100% { border-color: ${theme.accentDim}; box-shadow: none; }
}
.rhythm-tutorial-ball { animation: rhythm-tutorial-ball 1.8s ease-in infinite; }
.rhythm-tutorial-ring { animation: rhythm-tutorial-ring 1.8s linear infinite; }
`;

function StepRow({ emoji, text }: { emoji: string; text: string }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "5px 0",
        fontSize: "4vw",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: "5vw" }}>{emoji}</span>
      <span>{text}</span>
    </div>
  );
}

function LegendItem({ label, color }: { label: string; color: string }): ReactElement {
  return (
    <span
      style={{
        color,
        fontWeight: 700,
        fontSize: "3.8vw",
        padding: "2px 10px",
        borderRadius: "999px",
        border: `1px solid ${color}`,
      }}
    >
      {label}
    </span>
  );
}

export function TutorialScreen(): ReactElement {
  const closeTutorial = useShellStore((s) => s.closeTutorial);

  // 背景タップで閉じる（既読化のみ、効果音なし）。
  const handleDismiss = (): void => {
    markTutorialSeen();
    closeTutorial();
  };
  // 「わかった！」ボタンで閉じる（既読化 + 決定音）。
  const handleConfirm = (): void => {
    markTutorialSeen();
    uiConfirmSound();
    closeTutorial();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 31,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.72)",
        pointerEvents: "auto",
      }}
      onClick={handleDismiss}
    >
      <div
        style={{
          width: "86vw",
          maxWidth: "420px",
          background: theme.bgPanel,
          borderRadius: "16px",
          padding: "24px",
          color: theme.fg,
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
        onClick={(e): void => e.stopPropagation()}
      >
        <style>{DEMO_CSS}</style>
        <h2 style={{ margin: "0 0 12px", fontSize: "5vw" }}>あそびかた</h2>

        <div
          style={{
            position: "relative",
            height: "120px",
            marginBottom: "12px",
            overflow: "hidden",
            borderRadius: "12px",
            background: theme.bg,
          }}
        >
          <div
            className="rhythm-tutorial-ring"
            style={{
              position: "absolute",
              left: "50%",
              top: "64%",
              transform: "translate(-50%, -50%)",
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              border: `3px solid ${theme.accentDim}`,
            }}
          />
          <div
            className="rhythm-tutorial-ball"
            style={{
              position: "absolute",
              left: "50%",
              top: "64%",
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: theme.accent,
            }}
          />
        </div>

        <StepRow emoji="🥎" text="玉が奥からリングへとんでくる" />
        <StepRow emoji="👆" text="リングにかさなったしゅんかんに画面をタップ！" />
        <StepRow emoji="🏆" text="タイミングがよいほど高ランク" />

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "10px",
            margin: "14px 0 10px",
          }}
        >
          <LegendItem label="ぴったり" color={theme.accent} />
          <LegendItem label="セーフ" color={theme.safe} />
          <LegendItem label="ミス" color={theme.danger} />
        </div>

        <p style={{ margin: "0 0 4px", fontSize: "3.2vw", color: theme.fgDim }}>
          音とタイミングがずれてかんじたら⚙設定で調整できるよ
        </p>

        <HapticButton
          onClick={handleConfirm}
          style={{
            marginTop: "16px",
            width: "100%",
            padding: "12px",
            borderRadius: "999px",
            border: `2px solid ${theme.accent}`,
            background: theme.bgPanelAlt,
            color: theme.fg,
            fontSize: "4.5vw",
            fontWeight: 700,
          }}
        >
          わかった！
        </HapticButton>
      </div>
    </div>
  );
}
