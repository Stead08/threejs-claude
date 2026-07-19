//! 開発用楽曲 SMF の生成（midly）。docs/M0-SPEC.md §1.1 のメトロノームを
//! 「起承転結のある約 1 分の楽曲」へ拡張した M1 楽曲契約の実装。
//!
//! - カウントイン 2 小節 + 本編 28 小節（起 6 / 承 8 / 転 8 / 結 6）= 120 拍 ≈ 60 秒。
//! - SMF Format 1 / PPQ=480 / 120BPM 固定 / 4/4（テンポ変更禁止 —
//!   ゲーム側がリング脈動を 120BPM 前提で実装済み）。
//! - トラック: Track0=メタ / DRUMS(ch9) / BASS(ch1) / LEAD(ch0) / HARM(ch2) /
//!   CUES(ch0, レンダ時除外される譜面トラック)。
//! - 作曲はデータ駆動: コード進行は [`HARMONY`]、メロディは主題モチーフ
//!   （[`push_motif`] / [`push_cadence`]）の反復・変形で決定的に組み立てる。

use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

// ===== 時間の基本定数 =====

/// PPQ（4 分音符あたりのティック数）。
const PPQ: u16 = 480;
/// 拍あたりティック数（= PPQ）。
const TICKS_PER_BEAT: u32 = PPQ as u32;
/// 8 分音符（半拍）のティック数。キューの最小間隔でもある。
const HALF_BEAT: u32 = TICKS_PER_BEAT / 2;
/// 小節あたりティック数（4/4）。
const TICKS_PER_BAR: u32 = TICKS_PER_BEAT * 4;
/// カウントイン小節数。クリックのみ鳴らし CUES を置かない
/// （曲頭キューに接近時間 1 秒とテンポの手がかりを保証する）。
const COUNT_IN_BARS: u32 = 2;
/// 本編小節数（起 6 + 承 8 + 転 8 + 結 6）。
const MAIN_BARS: u32 = 28;
/// テンポ（マイクロ秒/拍、120BPM 固定）。
const TEMPO_US_PER_BEAT: u32 = 500_000;

// ===== 音価（ティック）。次の発音と重ならないよう格子より少し短くする =====

/// 8 分音符の実発音長。
const DUR_EIGHTH: u32 = 180;
/// 4 分音符の実発音長。
const DUR_QUARTER: u32 = 420;
/// 2 分音符の実発音長。
const DUR_HALF: u32 = 900;
/// 全音符の実発音長。終止音のノートオフも tick 120*480 以内に収まる。
const DUR_WHOLE: u32 = 1860;
/// 打楽器・キューの発音長。
const DUR_HIT: u32 = 60;

// ===== パーカッション（bank128 preset0）とキューのキー =====

/// キック（低音サイン減衰）。
const KICK: u8 = 35;
/// カウントインのクリック（1900Hz）。タップ SFX と同じ音。
const CLICK: u8 = 37;
/// アクセント（2400Hz）。
const ACCENT: u8 = 38;
/// ハイハット（ノイズ短減衰）。
const HAT: u8 = 42;
/// 通常キュー（overlay cueMap {36:0} 契約）。
const CUE_NORMAL: u8 = 36;
/// 大キュー = 小節頭等の強拍（overlay cueMap {38:1} 契約）。
const CUE_BIG: u8 = 38;

// 音名（MIDI ノート番号）。ベース用の低域とリード用の中高域のみ定義する。
const G2: u8 = 43;
const A2: u8 = 45;
const C3: u8 = 48;
const D3: u8 = 50;
const E3: u8 = 52;
const F3: u8 = 53;
const C4: u8 = 60;
const D4: u8 = 62;
const E4: u8 = 64;
const F4: u8 = 65;
const G4: u8 = 67;
const GS4: u8 = 68;
const A4: u8 = 69;
const B4: u8 = 71;
const C5: u8 = 72;
const D5: u8 = 74;
const E5: u8 = 76;
const F5: u8 = 77;

// ===== 和声（C メジャー） =====

/// 三和音の長短。
#[derive(Clone, Copy)]
enum Quality {
    /// 長三和音。
    Major,
    /// 短三和音。
    Minor,
}

/// コード（ベースが弾くルート + 長短）。
#[derive(Clone, Copy)]
struct Chord {
    /// ベーストラックが弾くルート（MIDI キー）。
    bass: u8,
    /// 長三和音か短三和音か。
    quality: Quality,
}

impl Chord {
    /// 3 度のインターバル（長 3 度 = 4 / 短 3 度 = 3 半音）。
    fn third(self) -> u8 {
        match self.quality {
            Quality::Major => 4,
            Quality::Minor => 3,
        }
    }

    /// HARM 用三和音（ベースの 1 オクターブ上に root/3rd/5th）。
    fn triad(self) -> [u8; 3] {
        let root = self.bass + 12;
        [root, root + self.third(), root + 7]
    }

    /// HARM 用 8 分アルペジオ 1 拍分（root→3rd→5th→oct の上行）。
    fn arpeggio(self) -> [u8; 4] {
        let root = self.bass + 12;
        [root, root + self.third(), root + 7, root + 12]
    }
}

/// C メジャー。
const CH_C: Chord = Chord {
    bass: C3,
    quality: Quality::Major,
};
/// D マイナー。
const CH_DM: Chord = Chord {
    bass: D3,
    quality: Quality::Minor,
};
/// E メジャー（Am のドミナント。ハーモニックマイナー由来の G# を含む）。
const CH_E: Chord = Chord {
    bass: E3,
    quality: Quality::Major,
};
/// F メジャー。
const CH_F: Chord = Chord {
    bass: F3,
    quality: Quality::Major,
};
/// G メジャー。
const CH_G: Chord = Chord {
    bass: G2,
    quality: Quality::Major,
};
/// A マイナー（平行短調）。
const CH_AM: Chord = Chord {
    bass: A2,
    quality: Quality::Minor,
};

/// 1 小節を同一コードで満たす（前半 2 拍 / 後半 2 拍）。
const fn whole_bar(chord: Chord) -> [Chord; 2] {
    [chord, chord]
}

/// 本編 28 小節のコード進行（添字 = 本編小節番号 - 1、各要素は前半/後半 2 拍ずつ）。
#[rustfmt::skip]
const HARMONY: [[Chord; 2]; MAIN_BARS as usize] = [
    // 起（1〜6 小節）: 静かな導入。
    whole_bar(CH_C), whole_bar(CH_C), whole_bar(CH_F),
    whole_bar(CH_C), whole_bar(CH_G), whole_bar(CH_C),
    // 承（7〜14 小節）: I–V–vi–IV 系で主題を展開。
    whole_bar(CH_C), whole_bar(CH_G), whole_bar(CH_AM), whole_bar(CH_F),
    whole_bar(CH_C), whole_bar(CH_G), whole_bar(CH_F), whole_bar(CH_C),
    // 転（15〜22 小節）: 平行短調 Am 系へ転じる。
    whole_bar(CH_AM), whole_bar(CH_F), whole_bar(CH_DM), whole_bar(CH_E),
    whole_bar(CH_AM), whole_bar(CH_F), whole_bar(CH_E), whole_bar(CH_E),
    // 結（23〜28 小節）: F G C Am | F→G | C の強いカデンツで C メジャーへ帰結。
    whole_bar(CH_F), whole_bar(CH_G), whole_bar(CH_C), whole_bar(CH_AM),
    [CH_F, CH_G], whole_bar(CH_C),
];

/// 転（15〜22 小節）のシンコペーション譜面パターン（小節内 8 分位置、偶数=表拍・奇数=拍裏）。
/// A = 拍 1, 2, 2.5, 3.5, 4 / B = 拍 1, 1.5, 2.5, 3, 4, 4.5。
/// A/B を交互に並べても隣接キュー間隔は常に 240 ティック（8 分）以上になる。
const SYNCO_PATTERNS: [&[u32]; 2] = [&[0, 2, 3, 5, 6], &[0, 1, 3, 4, 6, 7]];

// ===== ノート組み立ての中間表現 =====

/// 絶対ティック表現のノート 1 個。
struct NoteEv {
    /// NoteOn の絶対ティック。
    tick: u32,
    /// MIDI キー。
    key: u8,
    /// ベロシティ。
    vel: u8,
    /// 発音長（ティック）。
    dur: u32,
}

/// 本編小節番号（1 始まり）と小節内 8 分位置（0..8）から絶対ティックを得る。
fn tick_at(bar: u32, half_beat: u32) -> u32 {
    (COUNT_IN_BARS + bar - 1) * TICKS_PER_BAR + half_beat * HALF_BEAT
}

/// ノートを 1 個追加する。
fn push_note(out: &mut Vec<NoteEv>, bar: u32, half_beat: u32, key: u8, vel: u8, dur: u32) {
    out.push(NoteEv {
        tick: tick_at(bar, half_beat),
        key,
        vel,
        dur,
    });
}

/// 4 分音符×4 で 1 小節を埋める。
fn push_quarters(out: &mut Vec<NoteEv>, bar: u32, keys: [u8; 4], vel: u8) {
    for (i, key) in keys.into_iter().enumerate() {
        push_note(out, bar, i as u32 * 2, key, vel, DUR_QUARTER);
    }
}

/// 主題モチーフ「3 度→5 度→6 度→5 度」（4 分×4）。
/// `minor` なら短 3 度・短 6 度に変形して暗い表情にする（転で使用）。
fn push_motif(out: &mut Vec<NoteEv>, bar: u32, root: u8, minor: bool, vel: u8) {
    let (third, sixth) = if minor { (3, 8) } else { (4, 9) };
    push_quarters(
        out,
        bar,
        [root + third, root + 7, root + sixth, root + 7],
        vel,
    );
}

/// 終止句「3 度→2 度→1 度」（4 分・4 分・2 分）。主題の答句として使う。
fn push_cadence(out: &mut Vec<NoteEv>, bar: u32, root: u8, vel: u8) {
    push_note(out, bar, 0, root + 4, vel, DUR_QUARTER);
    push_note(out, bar, 2, root + 2, vel, DUR_QUARTER);
    push_note(out, bar, 4, root, vel, DUR_HALF);
}

// ===== トラック別の作曲 =====

/// DRUMS(ch9): カウントインのクリックと、本編のキック/ハット/アクセント。
/// 全キュー位置に必ず発音を置く（「聞こえる音を叩く」原則の担保はハット/キック側）。
fn build_drums() -> Vec<NoteEv> {
    let mut out = Vec::new();

    // --- カウントイン（2 小節）: クリックのみ + 小節頭アクセント。 ---
    for bar in 0..COUNT_IN_BARS {
        for beat in 0..4u32 {
            let (key, vel) = if beat == 0 {
                (ACCENT, 118)
            } else {
                (CLICK, 100)
            };
            out.push(NoteEv {
                tick: bar * TICKS_PER_BAR + beat * TICKS_PER_BEAT,
                key,
                vel,
                dur: DUR_HIT,
            });
        }
    }

    // --- 起（1〜6 小節）: キック 1・3 拍のみの静かな導入。3 小節目からハット 2・4 拍。 ---
    for bar in 1..=6 {
        for hb in [0, 4] {
            push_note(&mut out, bar, hb, KICK, 96, DUR_HIT);
        }
        if bar >= 3 {
            for hb in [2, 6] {
                push_note(&mut out, bar, hb, HAT, 44, DUR_HIT);
            }
        }
    }

    // --- 承（7〜14 小節）: キック 1・3 拍 + ハット 4 分。セクション頭にアクセント。 ---
    push_note(&mut out, 7, 0, ACCENT, 112, DUR_HIT);
    for bar in 7..=14 {
        for hb in [0, 4] {
            push_note(&mut out, bar, hb, KICK, 104, DUR_HIT);
        }
        for hb in [0, 2, 4, 6] {
            push_note(&mut out, bar, hb, HAT, 50, DUR_HIT);
        }
    }

    // --- 転（15〜22 小節）: キック 1・3 拍 + ハット 8 分（拍裏キューの発音を保証）。 ---
    push_note(&mut out, 15, 0, ACCENT, 116, DUR_HIT);
    for bar in 15..=22 {
        for hb in [0, 4] {
            push_note(&mut out, bar, hb, KICK, 106, DUR_HIT);
        }
        for hb in 0..8 {
            let vel = if hb % 2 == 0 { 54 } else { 44 };
            push_note(&mut out, bar, hb, HAT, vel, DUR_HIT);
        }
    }

    // --- 結（23〜26 小節）: 強拍中心に戻して一息つかせる。 ---
    push_note(&mut out, 23, 0, ACCENT, 116, DUR_HIT);
    for bar in 23..=26 {
        for hb in [0, 4] {
            push_note(&mut out, bar, hb, KICK, 104, DUR_HIT);
        }
        for hb in [2, 6] {
            push_note(&mut out, bar, hb, HAT, 48, DUR_HIT);
        }
    }

    // --- 結（27 小節）: ビルドアップ（キック 4 分 + ハット 8 分）。 ---
    push_note(&mut out, 27, 0, ACCENT, 118, DUR_HIT);
    for hb in [0, 2, 4, 6] {
        push_note(&mut out, 27, hb, KICK, 108, DUR_HIT);
    }
    for hb in 0..8 {
        push_note(&mut out, 27, hb, HAT, 56, DUR_HIT);
    }

    // --- 結（28 小節）: 終止の一撃。ロングトーンはメロディ側が担う。 ---
    push_note(&mut out, 28, 0, KICK, 110, DUR_HIT);
    push_note(&mut out, 28, 0, ACCENT, 124, DUR_HIT);

    out
}

/// BASS(ch1, 三角波): コード進行 [`HARMONY`] のルートを弾く。
fn build_bass() -> Vec<NoteEv> {
    let mut out = Vec::new();
    for bar in 1..=MAIN_BARS {
        let [first, second] = HARMONY[(bar - 1) as usize];
        match bar {
            // 起: ルートの 2 分弾き（静かな導入）。
            1..=6 => {
                push_note(&mut out, bar, 0, first.bass, 84, DUR_HALF);
                push_note(&mut out, bar, 4, second.bass, 84, DUR_HALF);
            }
            // 承: 4 分（ルート・ルート・5 度・ルート）で歩かせる。
            7..=14 => {
                push_note(&mut out, bar, 0, first.bass, 88, DUR_QUARTER);
                push_note(&mut out, bar, 2, first.bass, 88, DUR_QUARTER);
                push_note(&mut out, bar, 4, second.bass + 7, 88, DUR_QUARTER);
                push_note(&mut out, bar, 6, second.bass, 88, DUR_QUARTER);
            }
            // 転: ルートの 8 分刻みで緊張感を出す。
            15..=22 => {
                for hb in 0..8 {
                    let chord = if hb < 4 { first } else { second };
                    push_note(&mut out, bar, hb, chord.bass, 84, DUR_EIGHTH);
                }
            }
            // 結 23〜26: 2 分弾きに戻す。
            23..=26 => {
                push_note(&mut out, bar, 0, first.bass, 88, DUR_HALF);
                push_note(&mut out, bar, 4, second.bass, 88, DUR_HALF);
            }
            // 結 27: F→G の 4 分ビルドアップ（G2→C3 の属→主で終止へ）。
            27 => {
                push_note(&mut out, bar, 0, first.bass, 92, DUR_QUARTER);
                push_note(&mut out, bar, 2, first.bass, 92, DUR_QUARTER);
                push_note(&mut out, bar, 4, second.bass, 92, DUR_QUARTER);
                push_note(&mut out, bar, 6, second.bass, 92, DUR_QUARTER);
            }
            // 結 28: C の全音符で終止。
            28 => push_note(&mut out, bar, 0, first.bass, 88, DUR_WHOLE),
            _ => unreachable!("本編は 28 小節"),
        }
    }
    out
}

/// LEAD(ch0, 矩形波): 主題モチーフ（ミ・ソ・ラ・ソ）を起で提示し、
/// 承で展開、転で短調変形（1 オクターブ上）、結で解決する。すべて決定的。
fn build_lead() -> Vec<NoteEv> {
    let mut out = Vec::new();

    // --- 起（1〜6 小節）: 1〜2 小節は休符。3 小節目から主題 + 終止句を静かに 2 回提示。 ---
    push_motif(&mut out, 3, C4, false, 92);
    push_cadence(&mut out, 4, C4, 92);
    push_motif(&mut out, 5, C4, false, 92);
    push_cadence(&mut out, 6, C4, 92);

    // --- 承（7〜14 小節）: 主題をフルに歌わせる（応答句と再提示で展開）。 ---
    push_motif(&mut out, 7, C4, false, 100); // C: 主題
    push_quarters(&mut out, 8, [D4, G4, B4, G4], 100); // G: 上行の応答
    push_quarters(&mut out, 9, [C5, B4, A4, E4], 100); // Am: 頂点から下行
    push_quarters(&mut out, 10, [F4, A4, G4, F4], 100); // F: ゆらぎ
    push_motif(&mut out, 11, C4, false, 100); // C: 主題の再提示
    push_quarters(&mut out, 12, [D5, B4, G4, B4], 100); // G: 高い応答
    push_quarters(&mut out, 13, [C5, A4, F4, A4], 100); // F: 下行の準備
    push_cadence(&mut out, 14, C4, 100); // C: 前半の締め

    // --- 転（15〜22 小節）: 短調変形の主題を 1 オクターブ上で。E の G# で緊張を作る。 ---
    push_motif(&mut out, 15, A4, true, 104); // Am: 短調主題（C5 E5 F5 E5）
    push_quarters(&mut out, 16, [D5, C5, A4, C5], 104); // F: 揺れる応答
    push_quarters(&mut out, 17, [F5, E5, D5, A4], 104); // Dm: 頂点から下行
    push_quarters(&mut out, 18, [E5, B4, GS4, B4], 104); // E: ドミナントの緊張
    push_motif(&mut out, 19, A4, true, 104); // Am: 短調主題の反復
    push_quarters(&mut out, 20, [D5, C5, A4, F4], 104); // F: 沈み込み
    push_quarters(&mut out, 21, [GS4, B4, E5, B4], 104); // E: 上行で緊張を高める
    push_quarters(&mut out, 22, [E5, D5, B4, GS4], 104); // E: 下行で結へ受け渡し

    // --- 結（23〜28 小節）: 主題を F→G→C と上行させてクライマックス、C で終止。 ---
    push_motif(&mut out, 23, F4, false, 100); // F: 主題（サブドミナント）
    push_motif(&mut out, 24, G4, false, 104); // G: 主題（ドミナント）
    push_motif(&mut out, 25, C5, false, 108); // C: クライマックス（1 オクターブ上の主題）
    push_quarters(&mut out, 26, [E5, C5, A4, C5], 100); // Am: 落ち着き
    push_quarters(&mut out, 27, [A4, C5, B4, D5], 104); // F→G: ビルドアップの上行
    push_note(&mut out, 28, 0, E5, 100, DUR_WHOLE); // C: 全音符ロングトーンで終止

    out
}

/// HARM(ch2, 正弦波): 承・結は三和音パッド、転は 8 分アルペジオ。起は休み。
fn build_harm() -> Vec<NoteEv> {
    let mut out = Vec::new();
    for bar in 1..=MAIN_BARS {
        let [first, second] = HARMONY[(bar - 1) as usize];
        match bar {
            // 起: 休み（静かな導入はベースとリードだけで語る）。
            1..=6 => {}
            // 承: 三和音の全音符パッドで厚みを足す。
            7..=14 => {
                for key in first.triad() {
                    push_note(&mut out, bar, 0, key, 52, DUR_WHOLE);
                }
            }
            // 転: 8 分アルペジオ（root→3rd→5th→oct）で場面転換を演出する。
            15..=22 => {
                for hb in 0..8 {
                    let chord = if hb < 4 { first } else { second };
                    let key = chord.arpeggio()[(hb % 4) as usize];
                    push_note(&mut out, bar, hb, key, 56, DUR_EIGHTH);
                }
            }
            // 結 23〜26: パッドに戻す。
            23..=26 => {
                for key in first.triad() {
                    push_note(&mut out, bar, 0, key, 56, DUR_WHOLE);
                }
            }
            // 結 27: F→G の 2 分和音で高揚感を作る。
            27 => {
                for key in first.triad() {
                    push_note(&mut out, bar, 0, key, 60, DUR_HALF);
                }
                for key in second.triad() {
                    push_note(&mut out, bar, 4, key, 60, DUR_HALF);
                }
            }
            // 結 28: C 三和音の全音符で終止。
            28 => {
                for key in first.triad() {
                    push_note(&mut out, bar, 0, key, 56, DUR_WHOLE);
                }
            }
            _ => unreachable!("本編は 28 小節"),
        }
    }
    out
}

/// キューを 1 個置く。小節頭（half_beat=0）は大キュー key38、それ以外は key36。
fn push_cue(out: &mut Vec<NoteEv>, bar: u32, half_beat: u32) {
    let (key, vel) = if half_beat == 0 {
        (CUE_BIG, 112)
    } else {
        (CUE_NORMAL, 100)
    };
    push_note(out, bar, half_beat, key, vel, DUR_HIT);
}

/// CUES(ch0): 譜面トラック。全キュー位置には DRUMS/LEAD の発音が同ティックにある
/// （起・結 23〜26 はキック、毎拍区間はハット、拍裏は転・27 小節のハット 8 分）。
fn build_cues() -> Vec<NoteEv> {
    let mut out = Vec::new();

    // --- 起 1〜2 小節: 1・3 拍のみのまばらな導入。 ---
    for bar in 1..=2 {
        for hb in [0, 4] {
            push_cue(&mut out, bar, hb);
        }
    }
    // --- 起 3〜6 小節 + 承 7〜14 小節: 毎拍。 ---
    for bar in 3..=14 {
        for hb in [0, 2, 4, 6] {
            push_cue(&mut out, bar, hb);
        }
    }
    // --- 転 15〜22 小節: シンコペーション（A/B パターン交互、最難所）。 ---
    for bar in 15..=22 {
        for &hb in SYNCO_PATTERNS[((bar - 15) % 2) as usize] {
            push_cue(&mut out, bar, hb);
        }
    }
    // --- 結 23〜26 小節: 強拍（1・3 拍）のみに薄くする。 ---
    for bar in 23..=26 {
        for hb in [0, 4] {
            push_cue(&mut out, bar, hb);
        }
    }
    // --- 結 27 小節: ビルドアップ（毎拍 + 拍裏）。 ---
    for hb in 0..8 {
        push_cue(&mut out, 27, hb);
    }
    // --- 結 28 小節: 最後の大キュー 1 個。 ---
    push_cue(&mut out, 28, 0);

    out
}

// ===== SMF 組み立て =====

/// 開発用楽曲 SMF を生成してバイト列を返す（関数名は gen_midi との互換のため維持）。
///
/// - SMF Format 1、PPQ=480、120BPM 固定、4/4。
/// - カウントイン 2 小節 + 本編 28 小節 = 120 拍 ≈ 60 秒（最終イベント <= tick 120*480）。
/// - Track 0: テンポ・拍子メタのみ。
/// - "DRUMS"(ch9): キック(35)/クリック(37)/アクセント(38)/ハット(42)。
/// - "BASS"(ch1, ProgramChange 1): 三角波ベース。
/// - "LEAD"(ch0, ProgramChange 0): 矩形波リード（主題モチーフ）。
/// - "HARM"(ch2, ProgramChange 2): 正弦波ハーモニー（パッド/アルペジオ）。
/// - "CUES"(ch0): 譜面キュー（key36=通常 / key38=大）。レンダ時に除外される。
pub fn build_metronome_midi() -> Vec<u8> {
    let header = Header::new(Format::Parallel, Timing::Metrical(u15::new(PPQ)));
    let mut smf = Smf::new(header);

    smf.tracks.push(build_meta_track());
    smf.tracks
        .push(into_track(b"DRUMS", 9, None, build_drums()));
    smf.tracks
        .push(into_track(b"BASS", 1, Some(1), build_bass()));
    smf.tracks
        .push(into_track(b"LEAD", 0, Some(0), build_lead()));
    smf.tracks
        .push(into_track(b"HARM", 2, Some(2), build_harm()));
    smf.tracks.push(into_track(b"CUES", 0, None, build_cues()));

    let mut buf = Vec::new();
    smf.write_std(&mut buf).expect("SMF の書き込みに失敗");
    buf
}

/// Track 0（テンポ・拍子メタのみ）。
fn build_meta_track() -> Vec<TrackEvent<'static>> {
    vec![
        TrackEvent {
            delta: u28::new(0),
            // 4/4: numerator=4, denominator=2(=2^2), MIDI clocks/click=24, 32nd/quarter=8。
            kind: TrackEventKind::Meta(MetaMessage::TimeSignature(4, 2, 24, 8)),
        },
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::new(TEMPO_US_PER_BEAT))),
        },
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
        },
    ]
}

/// 絶対ティックのノート列を SMF トラック（デルタ表現）へ変換する。
/// `program` があれば先頭（tick 0）に ProgramChange を置く。
fn into_track(
    name: &'static [u8],
    channel: u8,
    program: Option<u8>,
    notes: Vec<NoteEv>,
) -> Vec<TrackEvent<'static>> {
    let ch = u4::new(channel);

    // NoteOn/NoteOff へ分解し、(tick, off 優先, key) で整列する。
    // 同ティックでは NoteOff を先に出し、同キー連打時の衝突を避ける。
    let mut msgs: Vec<(u32, bool, u8, u8)> = Vec::with_capacity(notes.len() * 2);
    for n in &notes {
        msgs.push((n.tick, true, n.key, n.vel));
        msgs.push((n.tick + n.dur, false, n.key, 0));
    }
    msgs.sort_by_key(|&(tick, is_on, key, _)| (tick, is_on, key));

    let mut track: Vec<TrackEvent> = Vec::with_capacity(msgs.len() + 3);
    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::TrackName(name)),
    });
    if let Some(program) = program {
        track.push(TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Midi {
                channel: ch,
                message: MidiMessage::ProgramChange {
                    program: u7::new(program),
                },
            },
        });
    }

    let mut last_tick: u32 = 0;
    for (tick, is_on, key, vel) in msgs {
        let message = if is_on {
            MidiMessage::NoteOn {
                key: u7::new(key),
                vel: u7::new(vel),
            }
        } else {
            MidiMessage::NoteOff {
                key: u7::new(key),
                vel: u7::new(0),
            }
        };
        track.push(TrackEvent {
            delta: u28::new(tick - last_tick),
            kind: TrackEventKind::Midi {
                channel: ch,
                message,
            },
        });
        last_tick = tick;
    }

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });
    track
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap, HashSet};

    use super::*;

    /// 設計上のキュー総数。
    /// - 起: 1〜2 小節 2 個×2 + 3〜6 小節 4 個×4 = 20
    /// - 承: 7〜14 小節 4 個×8 = 32
    /// - 転: 15〜22 小節 A(5 個)×4 + B(6 個)×4 = 44
    /// - 結: 23〜26 小節 2 個×4 + 27 小節 8 個 + 28 小節 1 個 = 17
    const EXPECTED_CUE_COUNT: usize = 113;

    /// トラックが指定名の TrackName メタを持つか。
    fn has_track_name(track: &[TrackEvent], name: &str) -> bool {
        track.iter().any(|ev| {
            matches!(
                ev.kind,
                TrackEventKind::Meta(MetaMessage::TrackName(n)) if n == name.as_bytes()
            )
        })
    }

    /// 指定名のトラックを取り出す。
    fn track_by_name<'a>(smf: &'a Smf, name: &str) -> &'a [TrackEvent<'a>] {
        smf.tracks
            .iter()
            .find(|t| has_track_name(t, name))
            .map(Vec::as_slice)
            .unwrap_or_else(|| panic!("トラック {name} が見つからない"))
    }

    /// NoteOn(vel>0) を (絶対ティック, キー, ベロシティ) で列挙する。
    fn note_ons(track: &[TrackEvent]) -> Vec<(u32, u8, u8)> {
        let mut abs: u32 = 0;
        let mut out = Vec::new();
        for ev in track {
            abs += ev.delta.as_int();
            if let TrackEventKind::Midi {
                message: MidiMessage::NoteOn { key, vel },
                ..
            } = ev.kind
            {
                if vel.as_int() > 0 {
                    out.push((abs, key.as_int(), vel.as_int()));
                }
            }
        }
        out
    }

    /// トラックの最終イベント絶対ティック。
    fn end_tick(track: &[TrackEvent]) -> u32 {
        track.iter().map(|ev| ev.delta.as_int()).sum()
    }

    #[test]
    fn parses_with_expected_structure() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).expect("生成した SMF がパースできない");

        assert_eq!(smf.header.format, Format::Parallel, "Format 1 ではない");
        assert_eq!(
            smf.header.timing,
            Timing::Metrical(u15::new(PPQ)),
            "PPQ が 480 ではない"
        );
        assert_eq!(smf.tracks.len(), 6, "トラック数が 6 でない");

        // トラック名の集合 = {DRUMS, BASS, LEAD, HARM, CUES}。
        let names: BTreeSet<&str> = ["DRUMS", "BASS", "LEAD", "HARM", "CUES"].into();
        for name in &names {
            assert!(
                smf.tracks.iter().any(|t| has_track_name(t, name)),
                "トラック {name} がない"
            );
        }

        // Track 0 は 120BPM のテンポと 4/4 の拍子メタを持つ。
        let has_tempo = smf.tracks[0].iter().any(|ev| {
            matches!(
                ev.kind,
                TrackEventKind::Meta(MetaMessage::Tempo(us)) if us.as_int() == TEMPO_US_PER_BEAT
            )
        });
        let has_timesig = smf.tracks[0].iter().any(|ev| {
            matches!(
                ev.kind,
                TrackEventKind::Meta(MetaMessage::TimeSignature(4, 2, _, _))
            )
        });
        assert!(has_tempo, "Track 0 に 120BPM のテンポメタがない");
        assert!(has_timesig, "Track 0 に 4/4 の拍子メタがない");
    }

    #[test]
    fn melodic_tracks_start_with_program_change() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();

        for (name, want_ch, want_prog) in [("BASS", 1u8, 1u8), ("LEAD", 0, 0), ("HARM", 2, 2)] {
            let track = track_by_name(&smf, name);
            let mut abs: u32 = 0;
            let first = track
                .iter()
                .find_map(|ev| {
                    abs += ev.delta.as_int();
                    match ev.kind {
                        TrackEventKind::Midi { channel, message } => {
                            Some((abs, channel.as_int(), message))
                        }
                        _ => None,
                    }
                })
                .unwrap_or_else(|| panic!("{name} に MIDI イベントがない"));

            assert_eq!(first.0, 0, "{name} の先頭 MIDI イベントが tick 0 でない");
            assert_eq!(first.1, want_ch, "{name} のチャンネルが不一致");
            assert!(
                matches!(
                    first.2,
                    MidiMessage::ProgramChange { program } if program.as_int() == want_prog
                ),
                "{name} の先頭が ProgramChange({want_prog}) でない"
            );
        }

        // DRUMS は ch9（bank128 が自動選択されるため ProgramChange なし）。
        let drums_ch9 = track_by_name(&smf, "DRUMS").iter().all(|ev| match ev.kind {
            TrackEventKind::Midi { channel, .. } => channel.as_int() == 9,
            _ => true,
        });
        assert!(drums_ch9, "DRUMS が ch9 でない");
    }

    #[test]
    fn cues_follow_overlay_contract() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();
        let cues = note_ons(track_by_name(&smf, "CUES"));

        assert_eq!(cues.len(), EXPECTED_CUE_COUNT, "キュー総数が設計値と不一致");

        // キーは 36（通常）と 38（大）のみ（overlay cueMap {36:0, 38:1} 契約）。
        assert!(
            cues.iter()
                .all(|&(_, key, _)| key == CUE_NORMAL || key == CUE_BIG),
            "cueMap にないキーが CUES にある"
        );

        // 最初のキューはカウントイン明け（拍 8）の大キュー。
        assert_eq!(
            (cues[0].0, cues[0].1),
            (COUNT_IN_BARS * TICKS_PER_BAR, CUE_BIG),
            "最初のキューの位置/キーがカウントイン仕様と不一致"
        );

        // 隣接キュー間隔は 8 分（240 ティック）以上（判定エンジン ±100ms の安全条件）。
        for pair in cues.windows(2) {
            assert!(
                pair[1].0 - pair[0].0 >= HALF_BEAT,
                "キュー間隔が 240 ティック未満: tick {} → {}",
                pair[0].0,
                pair[1].0
            );
        }

        // 大キューは小節頭のみで、本編の全小節に 1 個ずつある。
        let big: Vec<u32> = cues
            .iter()
            .filter(|&&(_, key, _)| key == CUE_BIG)
            .map(|&(tick, _, _)| tick)
            .collect();
        assert_eq!(
            big.len(),
            MAIN_BARS as usize,
            "大キュー数が本編小節数と不一致"
        );
        assert!(
            big.iter().all(|tick| tick % TICKS_PER_BAR == 0),
            "小節頭以外に大キューがある"
        );
    }

    #[test]
    fn cue_ticks_have_audible_note_on() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();

        // 「聞こえる音を叩く」原則: 全キューの tick に DRUMS または LEAD の NoteOn がある。
        let mut audible: HashSet<u32> = HashSet::new();
        for name in ["DRUMS", "LEAD"] {
            for (tick, _, _) in note_ons(track_by_name(&smf, name)) {
                audible.insert(tick);
            }
        }
        for (tick, key, _) in note_ons(track_by_name(&smf, "CUES")) {
            assert!(
                audible.contains(&tick),
                "キュー tick={tick} key={key} に DRUMS/LEAD の発音がない"
            );
        }
    }

    #[test]
    fn count_in_is_drums_click_only() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();
        let count_in_end = COUNT_IN_BARS * TICKS_PER_BAR;

        // カウントイン中の DRUMS はクリック(37)とアクセント(38)のみ。
        for (tick, key, _) in note_ons(track_by_name(&smf, "DRUMS")) {
            if tick < count_in_end {
                assert!(
                    key == CLICK || key == ACCENT,
                    "カウントイン中の DRUMS に想定外キー {key}"
                );
            }
        }
        // 他トラックはカウントイン中に発音しない。
        for name in ["BASS", "LEAD", "HARM", "CUES"] {
            if let Some(&(tick, _, _)) = note_ons(track_by_name(&smf, name)).first() {
                assert!(
                    tick >= count_in_end,
                    "{name} がカウントイン中（tick {tick}）に発音している"
                );
            }
        }
    }

    #[test]
    fn song_length_is_about_one_minute() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();

        // 最終イベント（全音符のノートオフ）が 120 拍以内、かつ 116 拍以上（約 1 分）。
        let last = smf.tracks.iter().map(|t| end_tick(t)).max().unwrap();
        assert!(
            last <= 120 * TICKS_PER_BEAT,
            "最終イベントが 120 拍（tick {}）を超えている: {last}",
            120 * TICKS_PER_BEAT
        );
        assert!(last >= 116 * TICKS_PER_BEAT, "曲が短すぎる: tick {last}");
    }

    #[test]
    fn note_on_off_are_paired() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();

        for (i, track) in smf.tracks.iter().enumerate() {
            let mut open: HashMap<u8, i32> = HashMap::new();
            for ev in track {
                if let TrackEventKind::Midi { message, .. } = ev.kind {
                    match message {
                        MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                            *open.entry(key.as_int()).or_insert(0) += 1;
                        }
                        MidiMessage::NoteOn { key, .. } | MidiMessage::NoteOff { key, .. } => {
                            let count = open.entry(key.as_int()).or_insert(0);
                            *count -= 1;
                            assert!(
                                *count >= 0,
                                "トラック {i}: key {} の NoteOff が過剰",
                                key.as_int()
                            );
                        }
                        _ => {}
                    }
                }
            }
            assert!(
                open.values().all(|&c| c == 0),
                "トラック {i} に鳴りっぱなしのノートがある: {open:?}"
            );
        }
    }
}
