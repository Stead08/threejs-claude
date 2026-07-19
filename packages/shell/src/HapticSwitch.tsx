// iOS Safari 用ハプティクス面。Safari 17.4+ の <input type="checkbox" switch> は
// ユーザーが実際にタップしてトグルされるとネイティブのハプティックが鳴る
// （iOS 26.5 以降、label.click() 等によるプログラム発火は塞がれている）。
// これを透明にして視覚要素の上へ重ね、指が直接触れるヒット面として使う。
// 状態（checked）には意味が無く、トグルされること自体が目的。

import type { CSSProperties, ReactElement } from "react";

// React の型定義に無い WebKit 非標準属性 switch を通すためのモジュール拡張。
// boolean だと React が未知属性への true をスキップするため文字列で渡す（switch=""）。
declare module "react" {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    /** Safari 17.4+: checkbox をネイティブスイッチとして描画する（存在ベースの属性）。 */
    switch?: string;
  }
}

export interface HapticSwitchProps {
  /** 重ね先の角丸。ヒットテストを角丸に合わせるため clip-path に反映する。 */
  borderRadius?: string | number;
  style?: CSSProperties;
}

export function HapticSwitch({ borderRadius, style }: HapticSwitchProps): ReactElement {
  const radius = typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius;
  return (
    <input
      type="checkbox"
      switch=""
      aria-hidden="true"
      tabIndex={-1}
      style={{
        position: "absolute",
        inset: 0,
        // ネイティブコントロールの固有サイズのままだとデッドゾーンができるため全面へ広げる。
        width: "100%",
        height: "100%",
        margin: 0,
        opacity: 0,
        // #root は pointer-events:none のため明示する。
        pointerEvents: "auto",
        // overflow:hidden は描画しか切り取らないため、ヒットテストは clip-path で丸める。
        ...(radius !== undefined ? { clipPath: `inset(0 round ${radius})` } : {}),
        ...style,
      }}
    />
  );
}
