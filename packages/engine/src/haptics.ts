// ハプティクスの薄い抽象。プラットフォームごとの発火手段が異なるため「モード判定」と
// 「Vibration API の短パルス」だけを提供する。
//
// - 'vibrate':    navigator.vibrate() が使える環境（Android の Chrome/Firefox 等）。
// - 'ios-switch': iOS/iPadOS Safari。Vibration API 非対応で、iOS 26.5 以降は
//                 <input type="checkbox" switch> のプログラム的トグル（label.click() 等）でも
//                 ハプティクスが鳴らないため、透明なスイッチを重ねて指で直接タップさせる
//                 （オーバレイの描画は shell 側の HapticSwitch が担う）。
// - 'none':       どちらも使えない環境（デスクトップ等）。

export type HapticsMode = 'vibrate' | 'ios-switch' | 'none';

/** テストで差し替え可能にするための navigator の必要最小サブセット。 */
export interface NavigatorLike {
  vibrate?: (pattern: number | number[]) => boolean;
  userAgent?: string;
  maxTouchPoints?: number;
}

/** タップ 1 回ぶんの振動パルス長（ミリ秒）。 */
export const HAPTIC_TAP_MS = 15;

function defaultNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

function isAppleTouchDevice(nav: NavigatorLike): boolean {
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) {
    return true;
  }
  // iPadOS 13+ はデスクトップ UA（Macintosh）を名乗るため、タッチ点数で Mac と区別する。
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/**
 * 実行環境のハプティクス発火手段を判定する。
 * vibrate の有無を先に見る（iOS には存在せず、Android には存在する）ため UA 判定は
 * Apple タッチ端末の識別にのみ使う。
 */
export function detectHapticsMode(nav: NavigatorLike | undefined = defaultNavigator()): HapticsMode {
  if (nav === undefined) {
    return 'none';
  }
  if (typeof nav.vibrate === 'function') {
    return 'vibrate';
  }
  if (isAppleTouchDevice(nav)) {
    return 'ios-switch';
  }
  return 'none';
}

/**
 * タップ 1 回ぶんの短い振動を鳴らす。Vibration API 非対応環境では no-op。
 * iOS のハプティクスはここでは鳴らせない（shell 側のスイッチオーバレイが担う）。
 */
export function hapticTap(nav: NavigatorLike | undefined = defaultNavigator()): void {
  if (nav !== undefined && typeof nav.vibrate === 'function') {
    nav.vibrate(HAPTIC_TAP_MS);
  }
}
