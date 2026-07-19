// プレイヤー向け HUD: コンボ数・判定ポップ・チュートリアルヒントを DOM 直書きで表示する
// （React 不使用、pointerEvents: none）。フレーム毎の update は持たず、全てイベント駆動 +
// Web Animations API（el.animate）で動かす。el.animate 非対応環境ではアニメーションを
// 諦めて静的表示のみ行う（ゲームプレイには影響しない）。

/** Just（ぴったり）ポップの文字色（金）。 */
const COLOR_JUST = "#ffce3a";
/** Safe（セーフ）ポップの文字色（青）。 */
const COLOR_SAFE = "#5ab0ff";
/** Miss（ミス）ポップの文字色（赤）。 */
const COLOR_MISS = "#ff5a5a";

/** コンボ表示を出す最小コンボ数（1 コンボでは出さない）。 */
const COMBO_MIN_VISIBLE = 2;

/** el.animate 非対応環境（古い WebView 等）では null を返してアニメーションを諦める。 */
function tryAnimate(
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  try {
    return el.animate(keyframes, options);
  } catch {
    return null;
  }
}

/**
 * プレイヤー向け HUD。judged()/missed() のイベント駆動で更新され、フレーム毎の
 * update() を必要としない。コンボ数の管理も内部で持つ。
 */
export class GameHud {
  readonly #comboEl: HTMLDivElement;
  readonly #judgeEl: HTMLDivElement;
  readonly #hintEl: HTMLDivElement;
  #combo = 0;
  #hintDismissed = false;
  #comboAnim: Animation | null = null;
  #judgeAnim: Animation | null = null;
  #hintAnim: Animation | null = null;

  constructor(parent: HTMLElement = document.body) {
    // コンボ表示: 画面上部中央。ノッチ（safe-area）を避けて配置する。
    const comboEl = document.createElement("div");
    comboEl.style.position = "fixed";
    comboEl.style.top = "max(48px, calc(env(safe-area-inset-top) + 40px))";
    comboEl.style.left = "0";
    comboEl.style.right = "0";
    comboEl.style.textAlign = "center";
    comboEl.style.font = "800 34px/1.2 system-ui, sans-serif";
    comboEl.style.letterSpacing = "0.04em";
    comboEl.style.color = "#ffffff";
    comboEl.style.textShadow = "0 2px 8px rgba(0,0,0,0.6)";
    comboEl.style.pointerEvents = "none";
    comboEl.style.zIndex = "999";
    comboEl.style.display = "none";
    parent.appendChild(comboEl);
    this.#comboEl = comboEl;

    // 判定ポップ: コンボの下。表示のたびに WAAPI で浮き上がりフェードさせる。
    const judgeEl = document.createElement("div");
    judgeEl.style.position = "fixed";
    judgeEl.style.top = "max(96px, calc(env(safe-area-inset-top) + 88px))";
    judgeEl.style.left = "0";
    judgeEl.style.right = "0";
    judgeEl.style.textAlign = "center";
    judgeEl.style.font = "700 22px/1.2 system-ui, sans-serif";
    judgeEl.style.textShadow = "0 1px 6px rgba(0,0,0,0.7)";
    judgeEl.style.pointerEvents = "none";
    judgeEl.style.zIndex = "999";
    judgeEl.style.opacity = "0";
    judgeEl.style.willChange = "transform, opacity";
    parent.appendChild(judgeEl);
    this.#judgeEl = judgeEl;

    // チュートリアルヒント: 画面下部（リング付近の上）でゆっくり点滅。
    const hintEl = document.createElement("div");
    hintEl.style.position = "fixed";
    hintEl.style.bottom = "26%";
    hintEl.style.left = "0";
    hintEl.style.right = "0";
    hintEl.style.textAlign = "center";
    hintEl.style.font = "600 15px/1.4 system-ui, sans-serif";
    hintEl.style.color = "rgba(255,255,255,0.92)";
    hintEl.style.textShadow = "0 1px 4px rgba(0,0,0,0.7)";
    hintEl.style.pointerEvents = "none";
    hintEl.style.zIndex = "999";
    hintEl.textContent = "◯ がリングにかさなったらタップ！";
    parent.appendChild(hintEl);
    this.#hintEl = hintEl;

    this.#hintAnim = tryAnimate(hintEl, [{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], {
      duration: 1800,
      iterations: Number.POSITIVE_INFINITY,
      easing: "ease-in-out",
    });
  }

  /** Judged（Just/Safe）を受けてコンボを進め、判定ポップを表示する。judgment: 0=Just / 1=Safe。 */
  judged(judgment: number): void {
    this.#dismissHint();
    this.#combo++;
    this.#updateCombo(true);
    if (judgment === 0) {
      this.#showJudgePop("ぴったり！", COLOR_JUST);
    } else {
      this.#showJudgePop("セーフ", COLOR_SAFE);
    }
  }

  /** AutoMiss を受けてコンボをリセットし、ミスのポップを表示する。 */
  missed(): void {
    this.#dismissHint();
    this.#combo = 0;
    this.#updateCombo(false);
    this.#showJudgePop("ミス", COLOR_MISS);
  }

  /** DOM とアニメーションを破棄する。 */
  dispose(): void {
    this.#comboAnim?.cancel();
    this.#judgeAnim?.cancel();
    this.#hintAnim?.cancel();
    this.#comboEl.remove();
    this.#judgeEl.remove();
    this.#hintEl.remove();
  }

  /** コンボ表示を現在値へ更新する。pop=true なら増加のポップアニメーションを再生する。 */
  #updateCombo(pop: boolean): void {
    if (this.#combo < COMBO_MIN_VISIBLE) {
      this.#comboEl.style.display = "none";
      return;
    }
    this.#comboEl.textContent = `${this.#combo} COMBO`;
    this.#comboEl.style.display = "block";
    if (pop) {
      this.#comboAnim?.cancel();
      this.#comboAnim = tryAnimate(
        this.#comboEl,
        [{ transform: "scale(1.35)" }, { transform: "scale(1)" }],
        { duration: 180, easing: "ease-out" },
      );
    }
  }

  /** 判定ポップを浮き上がりフェードで表示する。連打時は前のアニメを打ち切って再生し直す。 */
  #showJudgePop(text: string, color: string): void {
    this.#judgeEl.textContent = text;
    this.#judgeEl.style.color = color;
    this.#judgeAnim?.cancel();
    // el.animate 非対応環境では opacity 0 のまま（判定はシーン演出側で伝わる）。
    this.#judgeAnim = tryAnimate(
      this.#judgeEl,
      [
        { transform: "translateY(12px)", opacity: 1 },
        { transform: "translateY(-8px)", opacity: 0 },
      ],
      { duration: 500, easing: "ease-out", fill: "forwards" },
    );
  }

  /** 最初の判定イベントでチュートリアルヒントをフェードアウトし、以後表示しない。 */
  #dismissHint(): void {
    if (this.#hintDismissed) {
      return;
    }
    this.#hintDismissed = true;
    this.#hintAnim?.cancel();
    const fade = tryAnimate(this.#hintEl, [{ opacity: 1 }, { opacity: 0 }], {
      duration: 400,
      easing: "ease-out",
      fill: "forwards",
    });
    this.#hintAnim = fade;
    if (fade === null) {
      // アニメーション不可なら即座に隠す。
      this.#hintEl.style.display = "none";
    } else {
      fade.onfinish = (): void => {
        this.#hintEl.style.display = "none";
      };
    }
  }
}
