// 横向き警告オーバレイ。matchMedia('(orientation: landscape)') を監視し、横向き中は全画面警告を出す。
// appState に依存せず常時マウントされる（プレイ中の回転にも追従するため）。

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { theme } from '../theme';

const QUERY = '(orientation: landscape)';

function isLandscapeNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export function OrientationWarning(): ReactElement | null {
  const [landscape, setLandscape] = useState<boolean>(isLandscapeNow);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(QUERY);
    const handler = (): void => setLandscape(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return (): void => {
      mql.removeEventListener('change', handler);
    };
  }, []);

  if (!landscape) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.bg,
        color: theme.fg,
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: '24px',
        pointerEvents: 'auto',
      }}
    >
      <div>
        <div style={{ fontSize: '14vw', marginBottom: '16px' }} aria-hidden="true">
          📱
        </div>
        <div style={{ fontSize: '5.5vw', fontWeight: 700 }}>縦にしてもどしてね</div>
      </div>
    </div>
  );
}
