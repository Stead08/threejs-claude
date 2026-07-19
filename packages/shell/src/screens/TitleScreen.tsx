// タイトル画面。画面全体がタップボタン（「タップではじめる」）+ 右上に設定歯車。

import { useState } from "react";
import type { ReactElement } from "react";
import { theme } from "../theme";
import { useShellStore } from "../store";
import { HapticButton } from "../HapticButton";

export interface TitleScreenProps {
  onStart: () => Promise<void>;
}

export function TitleScreen({ onStart }: TitleScreenProps): ReactElement {
  const openSettings = useShellStore((s) => s.openSettings);
  const [starting, setStarting] = useState(false);

  const handleStart = (): void => {
    if (starting) {
      return;
    }
    setStarting(true);
    // 失敗時（unlock/ロード失敗）はタップし直せるよう starting を戻す。
    void onStart().catch(() => {
      setStarting(false);
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "auto" }}>
      <HapticButton
        onClick={handleStart}
        disabled={starting}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          background: `radial-gradient(circle at 50% 30%, ${theme.bgPanel}, ${theme.bg})`,
          border: "none",
          color: theme.fg,
          fontFamily: "system-ui, sans-serif",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: "13vw",
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: theme.accent,
            textShadow: "0 4px 24px rgba(0,0,0,0.5)",
          }}
        >
          カラテや
        </span>
        <span style={{ fontSize: "4.5vw", color: theme.fgDim }}>3D リズムゲーム</span>
        <span
          style={{
            marginTop: "48px",
            fontSize: "5.5vw",
            fontWeight: 700,
            padding: "14px 32px",
            borderRadius: "999px",
            border: `2px solid ${theme.accent}`,
            opacity: starting ? 0.5 : 1,
          }}
        >
          {starting ? "よみこみちゅう…" : "タップではじめる"}
        </span>
      </HapticButton>
      <HapticButton
        ariaLabel="設定"
        onClick={openSettings}
        style={{
          position: "fixed",
          top: "max(16px, env(safe-area-inset-top))",
          right: "max(16px, env(safe-area-inset-right))",
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          border: `1px solid ${theme.border}`,
          background: theme.bgPanelAlt,
          color: theme.fg,
          fontSize: "20px",
          lineHeight: 1,
          zIndex: 2,
        }}
      >
        ⚙
      </HapticButton>
    </div>
  );
}
