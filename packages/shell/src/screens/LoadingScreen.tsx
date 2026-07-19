// ローディング画面。loadProgress（0..1）を % のプログレスバーで表示する。

import type { ReactElement } from 'react';
import { theme } from '../theme';
import { useShellStore } from '../store';

export function LoadingScreen(): ReactElement {
  const progress = useShellStore((s) => s.loadProgress);
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        background: theme.bg,
        color: theme.fg,
        fontFamily: 'system-ui, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: '4.5vw', color: theme.fgDim }}>よみこみちゅう…</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{
          width: '70vw',
          height: '10px',
          borderRadius: '999px',
          background: theme.bgPanelAlt,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: theme.accent,
            transition: 'width 120ms linear',
          }}
        />
      </div>
      <span style={{ fontSize: '6vw', fontWeight: 700 }}>{pct}%</span>
    </div>
  );
}
