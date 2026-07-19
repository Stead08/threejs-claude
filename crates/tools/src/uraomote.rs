//! 「ウラオモテ」譜面 SMF の生成（midly）。
//!
//! 表拍(オモテ)セクションと裏拍(ウラ)セクションが交互に入れ替わる譜面。
//! 各セクションの最終小節（コール小節）ではクラップロールとリードの 16 分ランで
//! 次セクションへの切り替わりを予告する。

use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

/// PPQ（4 分音符あたりのティック数）。
const PPQ: u16 = 480;
/// 拍あたりティック数（= PPQ）。
const TICKS_PER_BEAT: u32 = PPQ as u32;
/// 半拍（裏打ち）のティック数。
const HALF_BEAT: u32 = TICKS_PER_BEAT / 2;
/// 16 分音符のティック数。
const SIXTEENTH: u32 = TICKS_PER_BEAT / 4;
/// テンポ（マイクロ秒/拍、≒116BPM）。
const TEMPO_US_PER_BEAT: u32 = 517_241;
/// ドラム/キューのノート長（1/8 拍 = 60 ティック）。
const HIT_LEN: u32 = TICKS_PER_BEAT / 8;
/// フィナーレ単発の拍位置。
const FINAL_BEAT: u32 = 128;

// パーカッションのキー（ch9）。
/// キック。
const KICK: u8 = 35;
/// アクセント（フィナーレ用）。
const ACCENT: u8 = 38;
/// クラップ。
const CLAP: u8 = 39;
/// クローズドハイハット。
const CHAT: u8 = 42;
/// オープンハイハット。
const OHAT: u8 = 46;

/// 表拍/裏拍セクションの種別。
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// 表拍（整数拍がキュー）。
    Omote,
    /// 裏拍（整数拍 +0.5 がキュー）。
    Ura,
}

/// セクション表（mode, 開始 beat, 終了 beat 排他）。
/// イントロ 0..8 とフィナーレ beat128 の単発は含まない。
const SECTIONS: [(Mode, u32, u32); 14] = [
    (Mode::Omote, 8, 24),
    (Mode::Ura, 24, 40),
    (Mode::Omote, 40, 56),
    (Mode::Ura, 56, 72),
    (Mode::Omote, 72, 80),
    (Mode::Ura, 80, 88),
    (Mode::Omote, 88, 96),
    (Mode::Ura, 96, 104),
    (Mode::Omote, 104, 108),
    (Mode::Ura, 108, 112),
    (Mode::Omote, 112, 116),
    (Mode::Ura, 116, 120),
    (Mode::Omote, 120, 124),
    (Mode::Ura, 124, 128),
];

/// コード定義（ベースルート・三和音・リードモチーフ）。
struct ChordDef {
    /// ベースのルート音。
    root: u8,
    /// コードの三和音。
    triad: [u8; 3],
    /// リードのモチーフ 4 音。
    motif: [u8; 4],
}

/// コード進行 Am → F → C → G（コンテンツ小節 n に対し `PROG[n % 4]`）。
/// イントロとフィナーレは Am（`PROG[0]`）。
const PROG: [ChordDef; 4] = [
    // Am
    ChordDef {
        root: 45,
        triad: [57, 60, 64],
        motif: [76, 72, 69, 72],
    },
    // F
    ChordDef {
        root: 41,
        triad: [57, 60, 65],
        motif: [77, 72, 69, 72],
    },
    // C
    ChordDef {
        root: 48,
        triad: [55, 60, 64],
        motif: [76, 79, 76, 72],
    },
    // G
    ChordDef {
        root: 43,
        triad: [55, 59, 62],
        motif: [74, 71, 67, 71],
    },
];

/// 「ウラオモテ」譜面 SMF を生成して SMF バイト列を返す。
///
/// - SMF Format 1、PPQ=480、≒116BPM 固定、4/4、32 小節 + フィナーレ単発（beat128）。
/// - Track 0: テンポ・拍子メタのみ。
/// - Track "DRUMS"（ch9）/ "BASS"（ch0）/ "CHORD"（ch1）/ "LEAD"（ch2）: 伴奏。
/// - Track "CUES"（ch0）: 判定用キュー。レンダ時に除外されるトラック。
///   オモテは各整数拍 key36、ウラは各整数拍 +0.5 に key37、フィナーレは key36。
pub fn build_uraomote_midi() -> Vec<u8> {
    let header = Header::new(Format::Parallel, Timing::Metrical(u15::new(PPQ)));
    let mut smf = Smf::new(header);

    smf.tracks.push(build_meta_track());
    smf.tracks
        .push(build_track(b"DRUMS", 9, None, drum_notes()));
    smf.tracks
        .push(build_track(b"BASS", 0, Some(1), bass_notes()));
    smf.tracks
        .push(build_track(b"CHORD", 1, Some(2), chord_notes()));
    smf.tracks
        .push(build_track(b"LEAD", 2, Some(0), lead_notes()));
    smf.tracks.push(build_track(b"CUES", 0, None, cue_notes()));

    let mut buf = Vec::new();
    smf.write_std(&mut buf).expect("SMF の書き込みに失敗");
    buf
}

/// 拍位置（整数拍）を絶対ティックへ変換する。
const fn bt(beat: u32) -> u32 {
    beat * TICKS_PER_BEAT
}

/// コンテンツ小節（beat8 の小節を 0 とし、以降 4 拍ごと）のコードを返す。
fn chord_at(bar_start: u32) -> &'static ChordDef {
    &PROG[(((bar_start - 8) / 4) % 4) as usize]
}

/// 絶対ティック指定のノート（NoteOn/NoteOff ペアの素）。
struct Note {
    /// NoteOn の絶対ティック。
    tick: u32,
    /// キー。
    key: u8,
    /// ベロシティ。
    vel: u8,
    /// 音長（ティック）。NoteOff は `tick + len`。
    len: u32,
}

/// 絶対ティックでノートを集めるバッファ。順不同で push してよい
/// （トラック化時に tick 順へソートされる）。
struct NoteBuf(Vec<Note>);

impl NoteBuf {
    fn new() -> Self {
        Self(Vec::new())
    }

    /// ノートを追加する。
    fn push(&mut self, tick: u32, key: u8, vel: u8, len: u32) {
        self.0.push(Note {
            tick,
            key,
            vel,
            len,
        });
    }

    /// 同 tick 同 key の既存ノートを取り除いてから追加する
    /// （コール小節ロールを既存パターンより優先し重複させないため）。
    fn push_replacing(&mut self, tick: u32, key: u8, vel: u8, len: u32) {
        self.0.retain(|n| !(n.tick == tick && n.key == key));
        self.push(tick, key, vel, len);
    }
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

/// ノートバッファをトラック化する。NoteOn/NoteOff を絶対ティックで展開し、
/// tick 順（同 tick では NoteOff を NoteOn より先）に整列してからデルタ変換する。
/// `program` が指定されればティック 0 に ProgramChange を置く。
fn build_track(
    name: &'static [u8],
    channel: u8,
    program: Option<u8>,
    notes: NoteBuf,
) -> Vec<TrackEvent<'static>> {
    let ch = u4::new(channel);

    // (絶対 tick, NoteOn か, key, vel)。同 tick では NoteOff（false < true）を先に置く。
    let mut events: Vec<(u32, bool, u8, u8)> = Vec::with_capacity(notes.0.len() * 2);
    for n in &notes.0 {
        events.push((n.tick, true, n.key, n.vel));
        events.push((n.tick + n.len, false, n.key, 0));
    }
    events.sort_by_key(|&(tick, on, _, _)| (tick, on));

    let mut track: Vec<TrackEvent> = Vec::with_capacity(events.len() + 3);
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

    // 絶対ティックからデルタタイムへ変換する。
    let mut last_tick: u32 = 0;
    for (tick, on, key, vel) in events {
        let message = if on {
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

/// DRUMS（ch9）: モードごとのビートパターンとコール小節のクラップロール。全ノート長 60。
fn drum_notes() -> NoteBuf {
    let mut buf = NoteBuf::new();

    // イントロ小節 1–2: キック各拍 + クローズドハイハット各 8 分。
    for beat in 0..8 {
        buf.push(bt(beat), KICK, 115, HIT_LEN);
        buf.push(bt(beat), CHAT, 55, HIT_LEN);
        buf.push(bt(beat) + HALF_BEAT, CHAT, 55, HIT_LEN);
    }
    // イントロ小節 2 のみ: クラップ（beat5,7）+ オープンハイハット（beat7.5）。
    buf.push(bt(5), CLAP, 105, HIT_LEN);
    buf.push(bt(7), CLAP, 105, HIT_LEN);
    buf.push(bt(7) + HALF_BEAT, OHAT, 90, HIT_LEN);

    for &(mode, start, end) in &SECTIONS {
        for bar in (start..end).step_by(4) {
            match mode {
                Mode::Omote => {
                    // キック各拍 / クラップ 2・4 拍目 / ハイハット各 8 分（表 60・裏 40）。
                    for k in 0..4 {
                        buf.push(bt(bar + k), KICK, 115, HIT_LEN);
                        buf.push(bt(bar + k), CHAT, 60, HIT_LEN);
                        buf.push(bt(bar + k) + HALF_BEAT, CHAT, 40, HIT_LEN);
                    }
                    buf.push(bt(bar + 1), CLAP, 105, HIT_LEN);
                    buf.push(bt(bar + 3), CLAP, 105, HIT_LEN);
                }
                Mode::Ura => {
                    // キック 1・3 拍目 / クラップ全裏拍 / ハイハット各表拍 / 4 拍目裏にオープン。
                    // 裏拍が主役の区間なので表拍（キック・ハット）を控えめにし、
                    // クラップを強めて裏打ちの聴き取りやすさを確保する。
                    buf.push(bt(bar), KICK, 100, HIT_LEN);
                    buf.push(bt(bar + 2), KICK, 100, HIT_LEN);
                    for k in 0..4 {
                        buf.push(bt(bar + k) + HALF_BEAT, CLAP, 115, HIT_LEN);
                        buf.push(bt(bar + k), CHAT, 45, HIT_LEN);
                    }
                    buf.push(bt(bar + 3) + HALF_BEAT, OHAT, 75, HIT_LEN);
                }
            }
            // コール小節（セクション最終小節）: 4 拍目にクラップロール + 締めのオープンハイハット。
            // 同 tick 同 key が既存パターンと重複したらロール側を優先する。
            if bar + 4 == end {
                let base = bt(bar + 3);
                for (i, vel) in [70u8, 85, 100, 115].into_iter().enumerate() {
                    buf.push_replacing(base + i as u32 * SIXTEENTH, CLAP, vel, HIT_LEN);
                }
                buf.push_replacing(base + 3 * SIXTEENTH, OHAT, 100, HIT_LEN);
            }
        }
    }

    // フィナーレ単発。
    buf.push(bt(FINAL_BEAT), KICK, 127, HIT_LEN);
    buf.push(bt(FINAL_BEAT), CLAP, 120, HIT_LEN);
    buf.push(bt(FINAL_BEAT), ACCENT, 120, HIT_LEN);
    buf.push(bt(FINAL_BEAT), OHAT, 100, HIT_LEN);

    buf
}

/// BASS（ch0, program1）: オモテは各拍ルート + 次小節ルートのピックアップ、ウラは 1・3 拍ロング。
fn bass_notes() -> NoteBuf {
    let mut buf = NoteBuf::new();

    // イントロ: A2 を 2 拍ごとに伸ばす。
    for beat in [0, 2, 4, 6] {
        buf.push(bt(beat), PROG[0].root, 100, 800);
    }

    for &(mode, start, end) in &SECTIONS {
        for bar in (start..end).step_by(4) {
            let root = chord_at(bar).root;
            match mode {
                Mode::Omote => {
                    for k in 0..4 {
                        buf.push(bt(bar + k), root, 100, 200);
                    }
                    // 4 拍目の裏に次小節ルートのピックアップ（次がフィナーレなら A2）。
                    let next_root = if bar + 4 >= FINAL_BEAT {
                        PROG[0].root
                    } else {
                        chord_at(bar + 4).root
                    };
                    buf.push(bt(bar + 3) + HALF_BEAT, next_root, 85, 200);
                }
                Mode::Ura => {
                    buf.push(bt(bar), root, 100, 900);
                    buf.push(bt(bar + 2), root, 100, 900);
                }
            }
        }
    }

    // フィナーレ: A2 ロング。
    buf.push(bt(FINAL_BEAT), PROG[0].root, 110, 1920);

    buf
}

/// CHORD（ch1, program2）: オモテは 1・3 拍の三和音、ウラは全裏拍のスカ裏打ち。
fn chord_notes() -> NoteBuf {
    let mut buf = NoteBuf::new();

    // イントロ: beat4 に Am を長めに 1 発。
    for key in PROG[0].triad {
        buf.push(bt(4), key, 50, 960);
    }

    for &(mode, start, end) in &SECTIONS {
        for bar in (start..end).step_by(4) {
            let triad = chord_at(bar).triad;
            match mode {
                Mode::Omote => {
                    for key in triad {
                        buf.push(bt(bar), key, 55, 430);
                        buf.push(bt(bar + 2), key, 55, 430);
                    }
                }
                Mode::Ura => {
                    for k in 0..4 {
                        for key in triad {
                            buf.push(bt(bar + k) + HALF_BEAT, key, 85, 100);
                        }
                    }
                }
            }
        }
    }

    // フィナーレ: Am（オクターブ上のルート付き）ロング。
    for key in [57, 60, 64, 69] {
        buf.push(bt(FINAL_BEAT), key, 85, 1920);
    }

    buf
}

/// LEAD（ch2, program0）: コードモチーフ。ウラは半拍シフト、コール小節は 16 分ランに差し替え。
fn lead_notes() -> NoteBuf {
    let mut buf = NoteBuf::new();

    // イントロのピックアップ 2 音。
    buf.push(bt(7), 72, 80, 200);
    buf.push(bt(7) + HALF_BEAT, 74, 85, 200);

    for (idx, &(mode, start, end)) in SECTIONS.iter().enumerate() {
        // 16 分ラン: 次セクションが ura なら上昇、omote/フィナーレなら下降。
        let run: [u8; 4] = match SECTIONS.get(idx + 1) {
            Some(&(Mode::Ura, ..)) => [76, 79, 81, 84],
            _ => [84, 81, 79, 76],
        };

        for bar in (start..end).step_by(4) {
            let call = bar + 4 == end;
            let motif = chord_at(bar).motif;
            // ウラは半拍シフト・弱め。コール小節では最後のモチーフ音を置かない。
            let (shift, vel) = match mode {
                Mode::Omote => (0, 85),
                Mode::Ura => (HALF_BEAT, 75),
            };
            for (k, &key) in motif.iter().enumerate() {
                if call && k == 3 {
                    continue;
                }
                buf.push(bt(bar + k as u32) + shift, key, vel, 300);
            }
            // コール小節: 4 拍目に 16 分ラン。
            if call {
                for (i, &key) in run.iter().enumerate() {
                    buf.push(
                        bt(bar + 3) + i as u32 * SIXTEENTH,
                        key,
                        95 + i as u8 * 5,
                        100,
                    );
                }
            }
        }
    }

    // フィナーレ: A5 ロング。
    buf.push(bt(FINAL_BEAT), 81, 95, 1920);

    buf
}

/// CUES（ch0）: 判定用キュー。オモテは各整数拍 key36、ウラは各整数拍 +0.5 に key37。
fn cue_notes() -> NoteBuf {
    let mut buf = NoteBuf::new();

    for &(mode, start, end) in &SECTIONS {
        for beat in start..end {
            match mode {
                Mode::Omote => buf.push(bt(beat), 36, 100, HIT_LEN),
                Mode::Ura => buf.push(bt(beat) + HALF_BEAT, 37, 100, HIT_LEN),
            }
        }
    }

    // フィナーレ単発キュー。
    buf.push(bt(FINAL_BEAT), 36, 100, HIT_LEN);

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    /// トラック名メタで対象トラックを引く。
    fn track_by_name<'a>(smf: &'a Smf<'a>, name: &[u8]) -> &'a [TrackEvent<'a>] {
        smf.tracks
            .iter()
            .find(|t| {
                t.iter().any(|ev| {
                    matches!(ev.kind, TrackEventKind::Meta(MetaMessage::TrackName(n)) if n == name)
                })
            })
            .map(|t| t.as_slice())
            .unwrap_or_else(|| panic!("トラック {} が見つからない", String::from_utf8_lossy(name)))
    }

    /// NoteOn(vel>0) を（絶対 tick, key, vel）で列挙する。
    fn note_ons(track: &[TrackEvent]) -> Vec<(u32, u8, u8)> {
        let mut tick: u32 = 0;
        let mut out = Vec::new();
        for ev in track {
            tick += ev.delta.as_int();
            if let TrackEventKind::Midi {
                message: MidiMessage::NoteOn { key, vel },
                ..
            } = ev.kind
            {
                if vel.as_int() > 0 {
                    out.push((tick, key.as_int(), vel.as_int()));
                }
            }
        }
        out
    }

    #[test]
    fn parses_with_expected_structure() {
        let bytes = build_uraomote_midi();
        let smf = Smf::parse(&bytes).expect("生成した SMF がパースできない");

        assert_eq!(smf.header.format, Format::Parallel, "Format 1 ではない");
        assert_eq!(
            smf.header.timing,
            Timing::Metrical(u15::new(PPQ)),
            "PPQ が 480 ではない"
        );
        assert_eq!(smf.tracks.len(), 6, "トラック数が 6 でない");

        // トラック名（Track 1 以降）を確認。
        let names: Vec<Vec<u8>> = smf.tracks[1..]
            .iter()
            .map(|t| {
                t.iter()
                    .find_map(|ev| match ev.kind {
                        TrackEventKind::Meta(MetaMessage::TrackName(n)) => Some(n.to_vec()),
                        _ => None,
                    })
                    .expect("トラック名メタがない")
            })
            .collect();
        let expected: Vec<Vec<u8>> = [&b"DRUMS"[..], b"BASS", b"CHORD", b"LEAD", b"CUES"]
            .iter()
            .map(|n| n.to_vec())
            .collect();
        assert_eq!(names, expected, "トラック名集合が仕様と不一致");

        // Track 0 はテンポ（517241 µs/beat）と拍子メタを持つ。
        let tempo = smf.tracks[0].iter().find_map(|ev| match ev.kind {
            TrackEventKind::Meta(MetaMessage::Tempo(t)) => Some(t.as_int()),
            _ => None,
        });
        assert_eq!(tempo, Some(TEMPO_US_PER_BEAT), "テンポが 517241 でない");
        let has_timesig = smf.tracks[0].iter().any(|ev| {
            matches!(
                ev.kind,
                TrackEventKind::Meta(MetaMessage::TimeSignature(..))
            )
        });
        assert!(has_timesig, "Track 0 に拍子メタがない");
    }

    #[test]
    fn cues_match_chart_spec() {
        let bytes = build_uraomote_midi();
        let smf = Smf::parse(&bytes).unwrap();
        let cues = note_ons(track_by_name(&smf, b"CUES"));

        // 16 拍 ×4 + 8 拍 ×4 + 4 拍 ×6 + フィナーレ 1 = 121。
        assert_eq!(cues.len(), 121, "CUES の NoteOn 数が 121 でない");

        // 最初のキューはオモテ開始（beat8 = tick3840）の key36。
        let (tick, key, _) = cues[0];
        assert_eq!(
            (tick, key),
            (bt(8), 36),
            "最初のキューが beat8/key36 でない"
        );

        // 最初のウラキューは beat24.5（tick11760）の key37。
        let &(tick, key, _) = cues
            .iter()
            .find(|&&(_, key, _)| key == 37)
            .expect("ウラキュー（key37）がない");
        assert_eq!(
            (tick, key),
            (bt(24) + HALF_BEAT, 37),
            "最初のウラキューが beat24.5/key37 でない"
        );
    }

    #[test]
    fn melodic_tracks_have_program_change() {
        let bytes = build_uraomote_midi();
        let smf = Smf::parse(&bytes).unwrap();

        // (トラック名, ch, program)。
        for (name, ch, program) in [(&b"BASS"[..], 0u8, 1u8), (b"CHORD", 1, 2), (b"LEAD", 2, 0)] {
            let track = track_by_name(&smf, name);
            let found = track.iter().any(|ev| {
                matches!(
                    ev.kind,
                    TrackEventKind::Midi {
                        channel,
                        message: MidiMessage::ProgramChange { program: p },
                    } if channel.as_int() == ch && p.as_int() == program
                )
            });
            assert!(
                found,
                "{} の ProgramChange(ch{ch}, program{program}) がない",
                String::from_utf8_lossy(name)
            );
        }
    }
}
