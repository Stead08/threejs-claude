// タイトル画面。ロゴ + ゲーム選択セクション（カタログのカード一覧）+「タップではじめる」+「あそびかた」。
// 選択中のゲームはカードを強調表示し、はじめるタップでそのゲームを起動する。右上に設定歯車。
// 初回訪問時はチュートリアルを自動で開く。

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { theme } from "../theme";
import { useShellStore } from "../store";
import { HapticButton } from "../HapticButton";
import { TUTORIAL_SEEN_KEY } from "./TutorialScreen";
import type { GameChoice } from "../AppShell";

export interface TitleScreenProps {
  games: readonly GameChoice[];
  onStart: (gameId: string) => Promise<void>;
}

export function TitleScreen({ games, onStart }: TitleScreenProps): ReactElement {
  const openSettings = useShellStore((s) => s.openSettings);
  const openTutorial = useShellStore((s) => s.openTutorial);
  const selectedGameId = useShellStore((s) => s.selectedGameId);
  const setSelectedGameId = useShellStore((s) => s.setSelectedGameId);
  const [starting, setStarting] = useState(false);

  // 未選択ならカタログ先頭を既定にする（空カタログ時のみ ""）。
  const effectiveId = selectedGameId ?? games[0]?.id ?? "";

  useEffect((): void => {
    // 初回訪問時は自動でチュートリアルを開く。openTutorial は冪等なので
    // StrictMode の二重実行でも問題ない。localStorage 不可環境では自動表示しない。
    try {
      if (globalThis.localStorage.getItem(TUTORIAL_SEEN_KEY) === null) {
        openTutorial();
      }
    } catch {
      // Cookie ブロック環境等ではアクセス自体が throw するため握りつぶす。
    }
  }, [openTutorial]);

  const handleStart = (): void => {
    if (starting || effectiveId === "") {
      return;
    }
    setStarting(true);
    // 失敗時（unlock/ロード失敗）はタップし直せるよう starting を戻す。
    void onStart(effectiveId).catch(() => {
      setStarting(false);
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: `radial-gradient(circle at 50% 22%, ${theme.bgPanel}, ${theme.bg})`,
        color: theme.fg,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
        padding:
          "max(24px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom)) 20px",
        overflowY: "auto",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        zIndex: 1,
      }}
    >
      <span
        style={{
          marginTop: "5vh",
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
          marginTop: "5vh",
          marginBottom: "12px",
          fontSize: "3.6vw",
          color: theme.fgDim,
          letterSpacing: "0.18em",
        }}
      >
        ゲームをえらぶ
      </span>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          width: "100%",
          maxWidth: "420px",
        }}
      >
        {games.map((game) => {
          const selected = game.id === effectiveId;
          return (
            <HapticButton
              key={game.id}
              disabled={starting}
              ariaLabel={game.name}
              onClick={(): void => {
                setSelectedGameId(game.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                width: "100%",
                padding: "16px 18px",
                borderRadius: "16px",
                border: `2px solid ${selected ? game.accent : theme.border}`,
                background: selected ? theme.bgPanelAlt : theme.bgPanel,
                color: theme.fg,
                textAlign: "left",
                boxShadow: selected ? `0 6px 20px rgba(0,0,0,0.35)` : "none",
                opacity: starting && !selected ? 0.5 : 1,
                touchAction: "manipulation",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: "14px",
                  height: "14px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: game.accent,
                  boxShadow: selected ? `0 0 10px ${game.accent}` : "none",
                }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                <span style={{ fontSize: "5vw", fontWeight: 700 }}>{game.name}</span>
                <span style={{ fontSize: "3.4vw", color: theme.fgDim }}>{game.description}</span>
              </span>
              <span
                aria-hidden
                style={{ fontSize: "5vw", color: selected ? game.accent : theme.accentDim }}
              >
                ▶
              </span>
            </HapticButton>
          );
        })}
      </div>

      {/* フッター（起動 +「あそびかた」）。marginTop:auto で下端へ寄せ、フロー内に積む
          （固定配置だと起動ボタンと重なるため）。 */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: "5vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "14px",
        }}
      >
        <HapticButton
          onClick={handleStart}
          disabled={starting}
          style={{
            background: "transparent",
            border: "none",
            color: theme.fg,
            padding: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: "5.5vw",
              fontWeight: 700,
              padding: "14px 32px",
              borderRadius: "999px",
              border: `2px solid ${theme.accent}`,
              background: theme.bgPanelAlt,
              opacity: starting ? 0.5 : 1,
            }}
          >
            {starting ? "よみこみちゅう…" : "タップではじめる"}
          </span>
        </HapticButton>

        <HapticButton
          onClick={openTutorial}
          disabled={starting}
          style={{
            padding: "10px 28px",
            borderRadius: "999px",
            border: `1px solid ${theme.border}`,
            background: theme.bgPanelAlt,
            color: theme.fgDim,
            fontSize: "4vw",
            opacity: starting ? 0.5 : 1,
          }}
        >
          あそびかた
        </HapticButton>
      </div>

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
