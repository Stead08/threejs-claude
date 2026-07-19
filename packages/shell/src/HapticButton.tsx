// タップでハプティックが鳴るボタン。プラットフォームごとに発火手段を切り替える:
//
// - vibrate / none: 素の <button>。pointerdown で navigator.vibrate() の短パルス
//   （非対応環境では no-op）。DOM 構造は従来のボタンと同一。
// - ios-switch: 見た目はそのまま div に載せ、透明な HapticSwitch を重ねる。
//   指がスイッチを直接トグルすることで WebKit ネイティブのハプティックが鳴り、
//   トグルで発生する click はバブリングして div の onClick に届く（1 タップ = 1 click）。

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { detectHapticsMode, hapticTap } from '@rhythm/engine';
import { HapticSwitch } from './HapticSwitch';

export interface HapticButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** アイコンのみ等、内容から名前が取れない場合のアクセシブルネーム。 */
  ariaLabel?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** 実行環境のハプティクスモード。環境は実行中に変わらないためモジュールロード時に一度だけ判定する。 */
const mode = detectHapticsMode();

export function HapticButton({
  onClick,
  disabled = false,
  ariaLabel,
  style,
  children,
}: HapticButtonProps): ReactElement {
  if (mode !== 'ios-switch') {
    return (
      <button
        type="button"
        onClick={onClick}
        onPointerDown={(): void => hapticTap()}
        disabled={disabled}
        aria-label={ariaLabel}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      role="button"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      // textAlign は button の UA 既定（中央寄せ）を再現する。position はスイッチの重ね先。
      style={{ position: 'relative', textAlign: 'center', ...style }}
    >
      {children}
      {disabled ? null : <HapticSwitch borderRadius={style?.borderRadius} />}
    </div>
  );
}
