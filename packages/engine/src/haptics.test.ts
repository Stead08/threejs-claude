import { describe, expect, it } from "vitest";
import { HAPTIC_TAP_MS, detectHapticsMode, hapticTap, type NavigatorLike } from "./haptics";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("detectHapticsMode", () => {
  it("vibrate があれば vibrate（Android 等）", () => {
    const nav: NavigatorLike = { userAgent: ANDROID_UA, vibrate: () => true };
    expect(detectHapticsMode(nav)).toBe("vibrate");
  });

  it("vibrate 無しの iPhone UA は ios-switch", () => {
    const nav: NavigatorLike = { userAgent: IPHONE_UA, maxTouchPoints: 5 };
    expect(detectHapticsMode(nav)).toBe("ios-switch");
  });

  it("デスクトップ UA を名乗る iPadOS（Macintosh + マルチタッチ）は ios-switch", () => {
    const nav: NavigatorLike = { userAgent: MAC_UA, maxTouchPoints: 5 };
    expect(detectHapticsMode(nav)).toBe("ios-switch");
  });

  it("タッチ無しの Mac Safari は none", () => {
    const nav: NavigatorLike = { userAgent: MAC_UA, maxTouchPoints: 0 };
    expect(detectHapticsMode(nav)).toBe("none");
  });

  it("判定材料が無ければ none", () => {
    expect(detectHapticsMode({})).toBe("none");
  });
});

describe("hapticTap", () => {
  it("vibrate 対応環境では HAPTIC_TAP_MS の単発パルスを鳴らす", () => {
    const calls: Array<number | number[]> = [];
    const nav: NavigatorLike = {
      vibrate: (pattern) => {
        calls.push(pattern);
        return true;
      },
    };
    hapticTap(nav);
    expect(calls).toEqual([HAPTIC_TAP_MS]);
  });

  it("vibrate 非対応環境では何もしない（throw しない）", () => {
    expect(() => hapticTap({ userAgent: IPHONE_UA })).not.toThrow();
  });
});
