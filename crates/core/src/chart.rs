//! MIDI + オーバレイ → 秒展開済み譜面へのコンパイル。

use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

use crate::overlay::Overlay;
use crate::tempo::TempoMap;

/// 秒展開済みのキュー 1 個。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cue {
    /// キュー発生時刻（秒）。
    pub time_sec: f64,
    /// 拍位置（beat = tick/ppq の連続量）。
    pub beat: f64,
    /// キュー種別 ID（オーバレイの cue_map 値）。
    pub kind: u16,
}

/// コンパイル済み譜面。
#[derive(Debug, Clone)]
pub struct Chart {
    /// 時刻昇順のキュー列。
    pub cues: Vec<Cue>,
    /// 曲の総尺（秒）= 全トラック最終イベント時刻 + 2.0。
    pub duration_sec: f64,
    /// テンポマップ。
    pub tempo_map: TempoMap,
}

/// 譜面コンパイル時のエラー。
#[derive(Debug, thiserror::Error)]
pub enum ChartError {
    /// MIDI のパースに失敗した。
    #[error("MIDI parse error: {0}")]
    Midi(String),
    /// PPQ（メトリカル）以外のタイミング、または PPQ=0。
    #[error("unsupported MIDI timing (only non-zero metrical/PPQ is supported)")]
    UnsupportedTiming,
    /// オーバレイで指定した cueTrack が MIDI に存在しない。
    #[error("cue track not found: {0}")]
    CueTrackNotFound(String),
}

/// トラック名メタ（最初の 1 個）を取り出す。
fn track_name(track: &[TrackEvent]) -> Option<String> {
    for ev in track {
        if let TrackEventKind::Meta(MetaMessage::TrackName(name)) = ev.kind {
            return Some(String::from_utf8_lossy(name).into_owned());
        }
    }
    None
}

/// MIDI バイト列とオーバレイから秒展開済み [`Chart`] を作る。
///
/// - タイミングは PPQ（メトリカル）のみ対応。
/// - テンポは全トラックの set_tempo を集約して [`TempoMap`] を構築する。
/// - `overlay.cue_track` と一致するトラック名メタを持つ最初のトラックの
///   NoteOn(vel>0) のみをキュー候補とし、`overlay.cue_map` に載っている
///   ノート番号だけを変換する（載っていないノートは無視）。
/// - `duration_sec` = 全トラック最終イベント時刻 + 2.0。
/// - `cues` は時刻昇順を保証する。
pub fn compile_chart(midi_bytes: &[u8], overlay: &Overlay) -> Result<Chart, ChartError> {
    let smf = Smf::parse(midi_bytes).map_err(|e| ChartError::Midi(e.to_string()))?;

    let ppq = match smf.header.timing {
        Timing::Metrical(t) => t.as_int() as u32,
        Timing::Timecode(..) => return Err(ChartError::UnsupportedTiming),
    };
    if ppq == 0 {
        return Err(ChartError::UnsupportedTiming);
    }

    // 1) 全トラックからテンポ変更点を集約し、同時に最終イベント tick を求める。
    let mut tempo_points: Vec<(u64, u32)> = Vec::new();
    let mut max_tick: u64 = 0;
    for track in &smf.tracks {
        let mut abs: u64 = 0;
        for ev in track {
            abs += u64::from(ev.delta.as_int());
            if let TrackEventKind::Meta(MetaMessage::Tempo(us)) = ev.kind {
                tempo_points.push((abs, us.as_int()));
            }
            if abs > max_tick {
                max_tick = abs;
            }
        }
    }
    let tempo_map = TempoMap::from_points(ppq, &tempo_points);

    // 2) cueTrack を探して NoteOn を変換する。
    let mut cues: Vec<Cue> = Vec::new();
    let mut found = false;
    for track in &smf.tracks {
        if track_name(track).as_deref() != Some(overlay.cue_track.as_str()) {
            continue;
        }
        found = true;
        let mut abs: u64 = 0;
        for ev in track {
            abs += u64::from(ev.delta.as_int());
            if let TrackEventKind::Midi {
                message: MidiMessage::NoteOn { key, vel },
                ..
            } = ev.kind
            {
                if vel.as_int() == 0 {
                    // vel=0 の NoteOn は NoteOff 扱い。
                    continue;
                }
                let key_str = key.as_int().to_string();
                if let Some(&kind) = overlay.cue_map.get(&key_str) {
                    cues.push(Cue {
                        time_sec: tempo_map.tick_to_sec(abs),
                        beat: abs as f64 / ppq as f64,
                        kind,
                    });
                }
            }
        }
        break; // 一致する最初のトラックのみ
    }
    if !found {
        return Err(ChartError::CueTrackNotFound(overlay.cue_track.clone()));
    }

    // 時刻昇順を保証（同時刻は beat で安定化）。
    cues.sort_by(|a, b| {
        a.time_sec
            .total_cmp(&b.time_sec)
            .then(a.beat.total_cmp(&b.beat))
    });

    let duration_sec = tempo_map.tick_to_sec(max_tick) + 2.0;

    Ok(Chart {
        cues,
        duration_sec,
        tempo_map,
    })
}
