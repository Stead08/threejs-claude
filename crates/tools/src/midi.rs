//! メトロノーム譜面 SMF の生成（midly）。docs/M0-SPEC.md §1.1。

use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

/// PPQ（4 分音符あたりのティック数）。
const PPQ: u16 = 480;
/// 総拍数（64 小節 × 4 拍）。
const BEATS: u32 = 256;
/// 拍あたりティック数（= PPQ）。
const TICKS_PER_BEAT: u32 = PPQ as u32;
/// ノート長（1/8 拍 = 60 ティック）。
const NOTE_LEN: u32 = TICKS_PER_BEAT / 8;
/// テンポ（マイクロ秒/拍、120BPM）。
const TEMPO_US_PER_BEAT: u32 = 500_000;

/// メトロノーム譜面 SMF を生成して SMF バイト列を返す。
///
/// - SMF Format 1、PPQ=480、120BPM 固定、4/4、64 小節 = 256 拍。
/// - Track 0: テンポ・拍子メタのみ。
/// - Track "CLICK"（ch9）: 毎拍 key37 vel100、小節頭は key38 vel127。
/// - Track "CUES"（ch0）: 毎拍 key36、小節頭は key38。
pub fn build_metronome_midi() -> Vec<u8> {
    let header = Header::new(Format::Parallel, Timing::Metrical(u15::new(PPQ)));
    let mut smf = Smf::new(header);

    smf.tracks.push(build_meta_track());
    // CLICK: ch9（パーカッション）。通常拍 key37/vel100、小節頭 key38/vel127。
    smf.tracks
        .push(build_note_track(b"CLICK", 9, 37, 100, 38, 127));
    // CUES: ch0。通常拍 key36、小節頭 key38。レンダ時に除外されるトラック。
    smf.tracks
        .push(build_note_track(b"CUES", 0, 36, 100, 38, 100));

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

/// 毎拍ノートを持つトラックを生成する。小節頭（4 拍ごと）だけ key/vel を差し替える。
fn build_note_track(
    name: &'static [u8],
    channel: u8,
    key_normal: u8,
    vel_normal: u8,
    key_bar: u8,
    vel_bar: u8,
) -> Vec<TrackEvent<'static>> {
    let ch = u4::new(channel);
    let mut track: Vec<TrackEvent> = Vec::with_capacity(BEATS as usize * 2 + 2);

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::TrackName(name)),
    });

    // 絶対ティックからデルタタイムへ変換する。
    let mut last_tick: u32 = 0;
    for beat in 0..BEATS {
        let bar_head = beat.is_multiple_of(4);
        let (key, vel) = if bar_head {
            (key_bar, vel_bar)
        } else {
            (key_normal, vel_normal)
        };

        let on_tick = beat * TICKS_PER_BEAT;
        let off_tick = on_tick + NOTE_LEN;

        track.push(TrackEvent {
            delta: u28::new(on_tick - last_tick),
            kind: TrackEventKind::Midi {
                channel: ch,
                message: MidiMessage::NoteOn {
                    key: u7::new(key),
                    vel: u7::new(vel),
                },
            },
        });
        last_tick = on_tick;

        track.push(TrackEvent {
            delta: u28::new(off_tick - last_tick),
            kind: TrackEventKind::Midi {
                channel: ch,
                message: MidiMessage::NoteOff {
                    key: u7::new(key),
                    vel: u7::new(0),
                },
            },
        });
        last_tick = off_tick;
    }

    track.push(TrackEvent {
        delta: u28::new(0),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    track
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(smf.tracks.len(), 3, "トラック数が 3 でない");

        // トラック名を確認。
        let names: Vec<Option<Vec<u8>>> = smf
            .tracks
            .iter()
            .map(|t| {
                t.iter().find_map(|ev| match ev.kind {
                    TrackEventKind::Meta(MetaMessage::TrackName(n)) => Some(n.to_vec()),
                    _ => None,
                })
            })
            .collect();
        assert_eq!(names[1].as_deref(), Some(&b"CLICK"[..]));
        assert_eq!(names[2].as_deref(), Some(&b"CUES"[..]));

        // Track 0 はテンポと拍子メタを持つ。
        let has_tempo = smf.tracks[0]
            .iter()
            .any(|ev| matches!(ev.kind, TrackEventKind::Meta(MetaMessage::Tempo(_))));
        let has_timesig = smf.tracks[0].iter().any(|ev| {
            matches!(
                ev.kind,
                TrackEventKind::Meta(MetaMessage::TimeSignature(..))
            )
        });
        assert!(has_tempo && has_timesig, "Track 0 のメタが不足");

        // CLICK トラックの NoteOn 数 = 256（毎拍）。
        let click_ons = count_note_ons(&smf.tracks[1]);
        assert_eq!(click_ons, BEATS as usize, "CLICK の NoteOn 数が 256 でない");
        let cues_ons = count_note_ons(&smf.tracks[2]);
        assert_eq!(cues_ons, BEATS as usize, "CUES の NoteOn 数が 256 でない");
    }

    #[test]
    fn bar_head_uses_accent_key() {
        let bytes = build_metronome_midi();
        let smf = Smf::parse(&bytes).unwrap();

        // CLICK: 最初の NoteOn は小節頭 → key38/vel127。
        let first = smf.tracks[1]
            .iter()
            .find_map(|ev| match ev.kind {
                TrackEventKind::Midi {
                    message: MidiMessage::NoteOn { key, vel },
                    ..
                } => Some((key.as_int(), vel.as_int())),
                _ => None,
            })
            .unwrap();
        assert_eq!(first, (38, 127), "CLICK 小節頭が key38/vel127 でない");
    }

    fn count_note_ons(track: &[TrackEvent]) -> usize {
        track
            .iter()
            .filter(|ev| {
                matches!(
                    ev.kind,
                    TrackEventKind::Midi {
                        message: MidiMessage::NoteOn { vel, .. },
                        ..
                    } if vel.as_int() > 0
                )
            })
            .count()
    }
}
