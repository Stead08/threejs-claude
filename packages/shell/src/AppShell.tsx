// シェル全体のルートコンポーネント。appState に応じて画面を出し分ける。
// appState === 'play' の間はどの状態画面も描画しない（HUD はゲーム側 DOM が担当し、
// React ツリーはゲームループから更新されない）。例外は iOS 用の PlayHapticLayer
// （静的な透明スイッチのみでゲームループから更新されない）。
// 横向き警告のみ appState と無関係に常時マウントする。

import type { ReactElement } from "react";
import { useShellStore } from "./store";
import { TitleScreen } from "./screens/TitleScreen";
import { LoadingScreen } from "./screens/LoadingScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TutorialScreen } from "./screens/TutorialScreen";
import { OrientationWarning } from "./screens/OrientationWarning";
import { PlayHapticLayer } from "./PlayHapticLayer";

/**
 * タイトルのゲーム選択に並べる 1 ゲームぶんのメタ情報。
 * shell は個別ゲームを知らない（境界: shell → engine のみ）ため、
 * カタログは合成点の apps/web から props で渡す。
 */
export interface GameChoice {
  /** レジストリ ID（apps/web の動的 import キーと一致）。 */
  id: string;
  /** 表示名。 */
  name: string;
  /** 1 行の説明。 */
  description: string;
  /** テーマ色（選択中の縁取り・アクセント）。 */
  accent: string;
}

export interface AppShellProps {
  /** タイトルに並べるゲームカタログ（表示順）。 */
  games: readonly GameChoice[];
  /** タイトルの「はじめる」タップ時。選択中のゲーム ID を渡す。
   * 呼び出し元（apps/web）が unlock → load → createScene → start を行う。 */
  onStart: (gameId: string) => Promise<void>;
  /** リザルト画面の「もういちど」タップ時。 */
  onRetry: () => void;
}

export function AppShell({ games, onStart, onRetry }: AppShellProps): ReactElement {
  const appState = useShellStore((s) => s.appState);
  const settingsOpen = useShellStore((s) => s.settingsOpen);
  const tutorialOpen = useShellStore((s) => s.tutorialOpen);

  return (
    <>
      {appState === "title" && <TitleScreen games={games} onStart={onStart} />}
      {appState === "loading" && <LoadingScreen />}
      {appState === "play" && <PlayHapticLayer />}
      {appState === "result" && <ResultScreen onRetry={onRetry} />}
      {settingsOpen && appState !== "play" && <SettingsScreen />}
      {tutorialOpen && appState !== "play" && <TutorialScreen />}
      <OrientationWarning />
    </>
  );
}
