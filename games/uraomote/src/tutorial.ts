// ウラオモテのチュートリアル字幕。曲位置（beat）に同期して遊び方を段階的に案内する。
// リズム天国流の「遊びながら覚える」導入: 最初のオモテ区間で表拍タップを、最初の
// フリップ前後で「半拍ずらす」ことを教え、以降は通常の ウラ!/オモテ! バナーに任せる。
// DOM 直描画（シーンの banner と同系の見た目・pointer-events なし）。dispose() で必ず除去する。

/** BPM116 の 1 拍の秒数。譜面（crates/tools/src/uraomote.rs）と一致させること。 */
const BEAT_SEC = 60 / 116;

/** 字幕 1 枚（表示区間は beat 単位・終端排他）。 */
interface Caption {
  fromBeat: number;
  untilBeat: number;
  text: string;
  /** アクセント色（CSS カラー）。 */
  color: string;
}

/**
 * チュートリアル字幕の時間割。曲構成（intro 2 小節 → オモテ 4 小節 → ウラ 4 小節 …）に同期。
 * 最初の 1 往復（〜beat 40）だけ案内し、以降は出さない。
 */
const CAPTIONS: readonly Caption[] = [
  { fromBeat: -4, untilBeat: 7.5, text: "♪ おとに あわせて タップ！", color: "#ffd166" },
  { fromBeat: 8, untilBeat: 15.5, text: "オモテ：ひょうしに あわせて！", color: "#ffd166" },
  { fromBeat: 21.5, untilBeat: 27.5, text: "つぎは ウラ！はんぱく ずらして！", color: "#5ac8ff" },
  { fromBeat: 29, untilBeat: 32, text: "あいだで タップ！その ちょうし！", color: "#5ac8ff" },
  { fromBeat: 37.5, untilBeat: 43, text: "オモテに もどるよ！", color: "#ffd166" },
];

/** ウラオモテのチュートリアル字幕。scene の update() から毎フレーム呼ばれる。 */
export class TutorialGuide {
  readonly #el: HTMLDivElement;
  #shownIndex = -1;

  constructor() {
    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:62%",
      "transform:translate(-50%,-50%)",
      "max-width:86vw",
      "padding:0.4em 0.8em",
      "border-radius:0.6em",
      "background:rgba(10,12,24,0.72)",
      "font-family:system-ui,sans-serif",
      "font-size:5.4vw",
      "font-weight:900",
      "line-height:1.4",
      "text-align:center",
      "letter-spacing:0.04em",
      "pointer-events:none",
      "z-index:20",
      "opacity:0",
      "transition:opacity 0.25s ease",
    ].join(";");
    document.body.appendChild(el);
    this.#el = el;
  }

  /** 曲位置（秒）から表示すべき字幕を選んで反映する。該当なしならフェードアウト。 */
  update(songPosSec: number): void {
    const beat = songPosSec / BEAT_SEC;
    let index = -1;
    for (let i = 0; i < CAPTIONS.length; i++) {
      const c = CAPTIONS[i];
      if (c !== undefined && beat >= c.fromBeat && beat < c.untilBeat) {
        index = i;
        break;
      }
    }

    if (index === this.#shownIndex) {
      return;
    }
    this.#shownIndex = index;

    if (index === -1) {
      this.#el.style.opacity = "0";
      return;
    }
    const caption = CAPTIONS[index];
    if (caption === undefined) {
      return;
    }
    this.#el.textContent = caption.text;
    this.#el.style.color = caption.color;
    this.#el.style.textShadow = `0 0 0.4em ${caption.color}55, 0 2px 0 #000`;
    this.#el.style.opacity = "1";
  }

  dispose(): void {
    this.#el.remove();
  }
}
