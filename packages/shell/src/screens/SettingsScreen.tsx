// 設定画面（歯車から開くオーバレイ）。inputOffsetMs / videoOffsetMs を -200..+200ms でスライダ調整し、
// CalibrationStore（engine 経由・localStorage）へ即時保存する。

import type { ChangeEvent, ReactElement } from 'react';
import { theme } from '../theme';
import { useShellStore } from '../store';
import { HapticButton } from '../HapticButton';

const OFFSET_MIN = -200;
const OFFSET_MAX = 200;
const OFFSET_STEP = 1;

export function SettingsScreen(): ReactElement {
  const calibration = useShellStore((s) => s.calibration);
  const setCalibration = useShellStore((s) => s.setCalibration);
  const closeSettings = useShellStore((s) => s.closeSettings);

  const handleInputOffset = (e: ChangeEvent<HTMLInputElement>): void => {
    setCalibration({ ...calibration, inputOffsetMs: Number(e.target.value) });
  };
  const handleVideoOffset = (e: ChangeEvent<HTMLInputElement>): void => {
    setCalibration({ ...calibration, videoOffsetMs: Number(e.target.value) });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        pointerEvents: 'auto',
      }}
      onClick={closeSettings}
    >
      <div
        style={{
          width: '86vw',
          maxWidth: '420px',
          background: theme.bgPanel,
          borderRadius: '16px',
          padding: '24px',
          color: theme.fg,
          fontFamily: 'system-ui, sans-serif',
        }}
        onClick={(e): void => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px', fontSize: '5vw' }}>設定</h2>

        <label style={{ display: 'block', marginBottom: '8px', fontSize: '4vw' }}>
          入力オフセット: {calibration.inputOffsetMs}ms
        </label>
        <input
          type="range"
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          step={OFFSET_STEP}
          value={calibration.inputOffsetMs}
          onChange={handleInputOffset}
          style={{ width: '100%' }}
        />

        <label style={{ display: 'block', margin: '20px 0 8px', fontSize: '4vw' }}>
          映像オフセット: {calibration.videoOffsetMs}ms
        </label>
        <input
          type="range"
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          step={OFFSET_STEP}
          value={calibration.videoOffsetMs}
          onChange={handleVideoOffset}
          style={{ width: '100%' }}
        />

        <HapticButton
          onClick={closeSettings}
          style={{
            marginTop: '24px',
            width: '100%',
            padding: '12px',
            borderRadius: '999px',
            border: `1px solid ${theme.border}`,
            background: theme.bgPanelAlt,
            color: theme.fg,
            fontSize: '4.2vw',
          }}
        >
          とじる
        </HapticButton>
      </div>
    </div>
  );
}
