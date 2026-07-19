// シェル全体のルートコンポーネント。appState に応じて画面を出し分ける。
// appState === 'play' の間はどの状態画面も描画しない（HUD はゲーム側 DOM が担当し、
// React ツリーはゲームループから更新されない）。横向き警告のみ appState と無関係に常時マウントする。

import type { ReactElement } from 'react';
import { useShellStore } from './store';
import { TitleScreen } from './screens/TitleScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { OrientationWarning } from './screens/OrientationWarning';

export interface AppShellProps {
  /** タイトルタップ時。呼び出し元（apps/web）が unlock → load → createScene → start を行う。 */
  onStart: () => Promise<void>;
  /** リザルト画面の「もういちど」タップ時。 */
  onRetry: () => void;
}

export function AppShell({ onStart, onRetry }: AppShellProps): ReactElement {
  const appState = useShellStore((s) => s.appState);
  const settingsOpen = useShellStore((s) => s.settingsOpen);

  return (
    <>
      {appState === 'title' && <TitleScreen onStart={onStart} />}
      {appState === 'loading' && <LoadingScreen />}
      {appState === 'result' && <ResultScreen onRetry={onRetry} />}
      {settingsOpen && appState !== 'play' && <SettingsScreen />}
      <OrientationWarning />
    </>
  );
}
