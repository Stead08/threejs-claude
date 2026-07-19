//! crates/core の網羅テスト。テスト用 MIDI は midly で組み立てる
//! （charts/ ディレクトリに依存しない）。
//!
//! 観点:
//! - テンポ変換（途中でテンポ変更する曲を含む）
//! - compile_chart（cueTrack 抽出・cueMap 変換・無視ノート・トラック未検出）
//! - 判定境界（±45.0ms, ±100.0ms ちょうど）
//! - 最近傍キュー割当（2 キューの中間の入力 → 早いキュー優先）
//! - AutoMiss / CueApproach の一回性と順序
//! - 同一入力列 → 同一イベント列の決定論
//! - Stats（既知データで mean・std・histogram 検算）

use crate::{
    compile_chart, Chart, ChartError, Cue, Engine, Event, Input, JudgeConfig, Judgment, Overlay,
    TempoMap,
};

use midly::num::{u15, u24, u28, u4, u7};
use midly::{Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind};

// ---------------------------------------------------------------------------
// MIDI 構築ヘルパ
// ---------------------------------------------------------------------------

fn ev(delta: u32, kind: TrackEventKind<'static>) -> TrackEvent<'static> {
    TrackEvent {
        delta: u28::new(delta),
        kind,
    }
}

fn note_on(ch: u8, key: u8, vel: u8) -> TrackEventKind<'static> {
    TrackEventKind::Midi {
        channel: u4::new(ch),
        message: MidiMessage::NoteOn {
            key: u7::new(key),
            vel: u7::new(vel),
        },
    }
}

fn track_name(name: &'static [u8]) -> TrackEventKind<'static> {
    TrackEventKind::Meta(MetaMessage::TrackName(name))
}

fn tempo(us_per_quarter: u32) -> TrackEventKind<'static> {
    TrackEventKind::Meta(MetaMessage::Tempo(u24::new(us_per_quarter)))
}

fn end_of_track() -> TrackEventKind<'static> {
    TrackEventKind::Meta(MetaMessage::EndOfTrack)
}

fn serialize(smf: &Smf) -> Vec<u8> {
    let mut buf = Vec::new();
    smf.write_std(&mut buf).expect("write MIDI");
    buf
}

fn header(ppq: u16) -> Header {
    Header::new(Format::Parallel, Timing::Metrical(u15::new(ppq)))
}

fn overlay_from(json: &str) -> Overlay {
    Overlay::from_json(json).expect("parse overlay")
}

const OVERLAY_JSON: &str = r#"{
    "meta": { "id": "t", "midi": "t.mid", "soundfont": "t.sf2" },
    "cueTrack": "CUES",
    "cueMap": { "36": 0, "38": 1 }
}"#;

// ---------------------------------------------------------------------------
// TempoMap
// ---------------------------------------------------------------------------

fn approx(a: f64, b: f64, eps: f64) -> bool {
    (a - b).abs() <= eps
}

#[test]
fn tempo_constant_120bpm() {
    // ppq=480, 120BPM (500000us/quarter) → 1 拍 = 0.5 秒。
    let tm = TempoMap::from_points(480, &[(0, 500_000)]);
    assert_eq!(tm.ppq(), 480);
    assert!(approx(tm.tick_to_sec(0), 0.0, 1e-12));
    assert!(approx(tm.tick_to_sec(480), 0.5, 1e-12));
    assert!(approx(tm.tick_to_sec(960), 1.0, 1e-12));
    assert!(approx(tm.beat_to_sec(1.0), 0.5, 1e-12));
    assert!(approx(tm.beat_to_sec(2.5), 1.25, 1e-12));
    assert!(approx(tm.sec_to_beat(0.5), 1.0, 1e-12));
    assert!(approx(tm.sec_to_beat(1.25), 2.5, 1e-12));
}

#[test]
fn tempo_default_when_empty_or_offset() {
    // 空 → 既定 120BPM。
    let tm = TempoMap::from_points(480, &[]);
    assert!(approx(tm.tick_to_sec(480), 0.5, 1e-12));

    // 先頭が tick 0 でない → tick 0 に 120BPM を補う。
    let tm2 = TempoMap::from_points(480, &[(960, 250_000)]);
    // 0..960 は 120BPM(0.5s/beat) → tick 960(=2beat) で 1.0 秒。
    assert!(approx(tm2.tick_to_sec(960), 1.0, 1e-12));
    // 960 以降は 240BPM(0.25s/beat)。
    assert!(approx(tm2.tick_to_sec(1440), 1.25, 1e-12));
}

#[test]
fn tempo_change_midway() {
    // ppq=480。tick0=120BPM(500000)、tick960=240BPM(250000)。
    let tm = TempoMap::from_points(480, &[(0, 500_000), (960, 250_000)]);
    // tick960 = 2 拍 * 0.5 = 1.0 秒。
    assert!(approx(tm.tick_to_sec(960), 1.0, 1e-12));
    // tick1440 = 1.0 + 1 拍 * 0.25 = 1.25 秒。
    assert!(approx(tm.tick_to_sec(1440), 1.25, 1e-12));
    // 逆変換。
    assert!(approx(tm.sec_to_beat(1.0), 2.0, 1e-12));
    assert!(approx(tm.sec_to_beat(1.25), 3.0, 1e-12));
    assert!(approx(tm.beat_to_sec(3.0), 1.25, 1e-12));
    // 往復整合。
    for &sec in &[0.1, 0.5, 1.0, 1.1, 1.25, 2.0] {
        let beat = tm.sec_to_beat(sec);
        assert!(approx(tm.beat_to_sec(beat), sec, 1e-9));
    }
}

#[test]
fn tempo_same_tick_last_wins() {
    // 同一 tick に 2 テンポ → 後勝ち（250000 が採用される）。
    let tm = TempoMap::from_points(480, &[(0, 500_000), (0, 250_000)]);
    assert!(approx(tm.tick_to_sec(480), 0.25, 1e-12));
}

// ---------------------------------------------------------------------------
// Overlay（serde, camelCase, 未知フィールド無視）
// ---------------------------------------------------------------------------

#[test]
fn overlay_camel_case_and_ignores_sfx() {
    // charts/metronome.json と同形（sfx 付き）。sfx は core では未使用 → 無視される。
    let json = r#"{
        "meta": { "id": "metronome", "midi": "metronome.mid", "soundfont": "dev.sf2" },
        "cueTrack": "CUES",
        "cueMap": { "36": 0, "38": 1 },
        "sfx": { "tap": { "percussion": true, "preset": 0, "key": 37, "velocity": 100, "durationSec": 0.3 } }
    }"#;
    let ov = Overlay::from_json(json).expect("parse overlay with sfx");
    assert_eq!(ov.meta.id, "metronome");
    assert_eq!(ov.meta.midi, "metronome.mid");
    assert_eq!(ov.meta.soundfont, "dev.sf2");
    assert_eq!(ov.cue_track, "CUES");
    assert_eq!(ov.cue_map.get("36"), Some(&0));
    assert_eq!(ov.cue_map.get("38"), Some(&1));
}

// ---------------------------------------------------------------------------
// compile_chart
// ---------------------------------------------------------------------------

fn build_compile_midi() -> Vec<u8> {
    let mut smf = Smf::new(header(480));

    // Track 0: テンポメタのみ。
    smf.tracks
        .push(vec![ev(0, tempo(500_000)), ev(1920, end_of_track())]);

    // CLICK トラック（cueTrack ではない）。key36 を含むが無視されるべき。
    smf.tracks.push(vec![
        ev(0, track_name(b"CLICK")),
        ev(0, note_on(9, 36, 100)),
        ev(1920, end_of_track()),
    ]);

    // CUES トラック。
    smf.tracks.push(vec![
        ev(0, track_name(b"CUES")),
        ev(0, note_on(0, 36, 100)),   // tick0   → kind0
        ev(480, note_on(0, 38, 127)), // tick480 → kind1
        ev(480, note_on(0, 40, 100)), // tick960 → cueMap 外 → 無視
        ev(480, note_on(0, 36, 0)),   // tick1440 vel0 → NoteOff 扱い → 無視
        ev(480, end_of_track()),      // tick1920
    ]);

    serialize(&smf)
}

#[test]
fn compile_extracts_cues_and_ignores() {
    let midi = build_compile_midi();
    let overlay = overlay_from(OVERLAY_JSON);
    let chart = compile_chart(&midi, &overlay).expect("compile");

    assert_eq!(chart.cues.len(), 2, "mapped NoteOn 2 個のみ");

    assert!(approx(chart.cues[0].time_sec, 0.0, 1e-12));
    assert!(approx(chart.cues[0].beat, 0.0, 1e-12));
    assert_eq!(chart.cues[0].kind, 0);

    assert!(approx(chart.cues[1].time_sec, 0.5, 1e-12)); // tick480 @120BPM
    assert!(approx(chart.cues[1].beat, 1.0, 1e-12));
    assert_eq!(chart.cues[1].kind, 1);

    // duration = 全トラック最終 tick(1920 = 2.0s) + 2.0。
    assert!(approx(chart.duration_sec, 4.0, 1e-9));

    // 昇順であること。
    for w in chart.cues.windows(2) {
        assert!(w[0].time_sec <= w[1].time_sec);
    }
}

#[test]
fn compile_tempo_change_affects_cue_times() {
    let mut smf = Smf::new(header(480));
    // Track0: tick0 120BPM, tick960 240BPM。
    smf.tracks.push(vec![
        ev(0, tempo(500_000)),
        ev(960, tempo(250_000)),
        ev(960, end_of_track()),
    ]);
    // CUES: tick0(key36), tick960(key38), tick1440(key36)。
    smf.tracks.push(vec![
        ev(0, track_name(b"CUES")),
        ev(0, note_on(0, 36, 100)),   // tick0    → 0.0s
        ev(960, note_on(0, 38, 100)), // tick960  → 1.0s
        ev(480, note_on(0, 36, 100)), // tick1440 → 1.25s
        ev(480, end_of_track()),      // tick1920
    ]);
    let midi = serialize(&smf);
    let chart = compile_chart(&midi, &overlay_from(OVERLAY_JSON)).expect("compile");

    assert_eq!(chart.cues.len(), 3);
    assert!(approx(chart.cues[0].time_sec, 0.0, 1e-12));
    assert!(approx(chart.cues[1].time_sec, 1.0, 1e-12));
    assert!(approx(chart.cues[2].time_sec, 1.25, 1e-12));
}

#[test]
fn compile_cue_track_not_found() {
    let midi = build_compile_midi();
    let overlay = overlay_from(
        r#"{"meta":{"id":"t","midi":"t.mid","soundfont":"t.sf2"},"cueTrack":"NOPE","cueMap":{"36":0}}"#,
    );
    let err = compile_chart(&midi, &overlay).unwrap_err();
    assert!(matches!(err, ChartError::CueTrackNotFound(name) if name == "NOPE"));
}

#[test]
fn compile_deterministic() {
    let midi = build_compile_midi();
    let overlay = overlay_from(OVERLAY_JSON);
    let a = compile_chart(&midi, &overlay).expect("a");
    let b = compile_chart(&midi, &overlay).expect("b");
    assert_eq!(a.cues, b.cues);
    assert_eq!(a.duration_sec, b.duration_sec);
}

// ---------------------------------------------------------------------------
// 判定エンジン
// ---------------------------------------------------------------------------

fn chart_from_targets(targets: &[(f64, u16)], duration: f64) -> Chart {
    let cues = targets
        .iter()
        .map(|&(t, k)| Cue {
            time_sec: t,
            beat: 0.0,
            kind: k,
        })
        .collect();
    Chart {
        cues,
        duration_sec: duration,
        tempo_map: TempoMap::from_points(480, &[]),
    }
}

fn tap(time_sec: f64) -> Input {
    Input { time_sec, verb: 0 }
}

fn find_judged(events: &[Event]) -> Option<(u32, Judgment, f64)> {
    events.iter().find_map(|e| match e {
        Event::Judged {
            cue_index,
            judgment,
            error_ms,
        } => Some((*cue_index, *judgment, *error_ms)),
        _ => None,
    })
}

/// 誤差（ms）を厳密に構築して単一キューを判定する。
///
/// target=0.0 のとき `error_ms/1000.0` を入力時刻に使うと、
/// engine 側の `(input - 0.0) * 1000.0` は元の境界値（45.0 / 100.0 等）を
/// f64 で厳密に復元する（`target - 0.5` の加算で丸め誤差を混入させない）。
fn judge_error(error_ms: f64) -> Option<(u32, Judgment, f64)> {
    let input_time = error_ms / 1000.0;
    let chart = chart_from_targets(&[(0.0, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();
    engine.tick(-0.5, &[], &mut events); // 接近を消化
    engine.tick(input_time.max(-0.4), &[tap(input_time)], &mut events);
    find_judged(&events)
}

#[test]
fn judge_boundaries() {
    // ちょうど ±45ms → Just（境界含む）。
    let (_, j, e) = judge_error(45.0).expect("just+45");
    assert_eq!(j, Judgment::Just);
    assert!(approx(e, 45.0, 1e-12));

    let (_, j, e) = judge_error(-45.0).expect("just-45");
    assert_eq!(j, Judgment::Just);
    assert!(approx(e, -45.0, 1e-12));

    // 45ms を少し超える → Safe。
    assert_eq!(judge_error(46.0).expect("safe+46").1, Judgment::Safe);
    assert_eq!(judge_error(-46.0).expect("safe-46").1, Judgment::Safe);

    // ちょうど ±100ms → Safe（境界含む）。
    let (_, j, e) = judge_error(100.0).expect("safe+100");
    assert_eq!(j, Judgment::Safe);
    assert!(approx(e, 100.0, 1e-12));

    let (_, j, e) = judge_error(-100.0).expect("safe-100");
    assert_eq!(j, Judgment::Safe);
    assert!(approx(e, -100.0, 1e-12));

    // 100ms を超える → 未マッチ（Judged イベントなし）。
    assert!(judge_error(101.0).is_none());
    assert!(judge_error(-101.0).is_none());
}

#[test]
fn judge_nearest_cue_tie_prefers_earlier() {
    // cue0=0.0, cue1=0.08。0.08 == 2*0.04 は f64 で厳密。
    // 入力 0.04 は両者から厳密に等距離 → 早いキュー(0)優先。
    let chart = chart_from_targets(&[(0.0, 0), (0.08, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();
    engine.tick(0.0, &[], &mut events); // 接近消化
    engine.tick(0.05, &[tap(0.04)], &mut events);
    let (idx, j, _) = find_judged(&events).expect("judged");
    assert_eq!(idx, 0, "同距離タイは早いキュー優先");
    assert_eq!(j, Judgment::Just);
}

#[test]
fn judge_nearest_cue_picks_closer() {
    // cue0=1.0, cue1=1.06。入力1.04 → cue0誤差+40, cue1誤差-20 → cue1採用。
    let chart = chart_from_targets(&[(1.0, 0), (1.06, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();
    engine.tick(0.5, &[], &mut events);
    engine.tick(1.05, &[tap(1.04)], &mut events);
    let (idx, j, e) = find_judged(&events).expect("judged");
    assert_eq!(idx, 1);
    assert_eq!(j, Judgment::Just); // |-20| <= 45
    assert!(approx(e, -20.0, 1e-9));
}

#[test]
fn auto_miss_after_window() {
    let chart = chart_from_targets(&[(1.0, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();

    // ウィンドウ内（now=1.05 <= 1.0+0.1）→ ミスなし。
    engine.tick(1.05, &[], &mut events);
    assert!(!events.iter().any(|e| matches!(e, Event::AutoMiss { .. })));
    assert_eq!(engine.stats().miss, 0);

    // ウィンドウ超過（now=1.2 > 1.1）→ AutoMiss。
    engine.tick(1.2, &[], &mut events);
    assert!(events
        .iter()
        .any(|e| matches!(e, Event::AutoMiss { cue_index: 0 })));
    assert_eq!(engine.stats().miss, 1);
    assert_eq!(engine.stats().judged, 1);

    // 二度目は再発火しない。
    engine.tick(1.3, &[], &mut events);
    assert!(!events.iter().any(|e| matches!(e, Event::AutoMiss { .. })));
    assert_eq!(engine.stats().miss, 1);

    assert!(engine.finished(1.3), "全キュー判定済み");
}

#[test]
fn auto_miss_not_triggered_when_input_saves() {
    // 同一 tick 内で入力がキューを救済（入力→オートミスの順）。
    let chart = chart_from_targets(&[(1.0, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();
    engine.tick(0.5, &[], &mut events);
    // now=1.2(>1.1) でオートミス条件だが、入力1.08(安全内)が先に判定。
    engine.tick(1.2, &[tap(1.08)], &mut events);
    assert!(matches!(find_judged(&events), Some((0, Judgment::Safe, _))));
    assert!(!events.iter().any(|e| matches!(e, Event::AutoMiss { .. })));
    assert_eq!(engine.stats().miss, 0);
    assert_eq!(engine.stats().safe, 1);
}

#[test]
fn cue_approach_once_and_ordered() {
    // approach_sec=0.5, cue0=1.0(kind0), cue1=2.0(kind1)。
    let chart = chart_from_targets(&[(1.0, 0), (2.0, 1)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 0.5);
    let mut events = Vec::new();

    // now=0.4 → まだ接近しない（1.0-0.5=0.5 > 0.4）。
    engine.tick(0.4, &[], &mut events);
    assert!(events.is_empty());

    // now=0.6 → cue0 のみ接近。
    engine.tick(0.6, &[], &mut events);
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0],
        Event::CueApproach {
            cue_index: 0,
            kind: 0,
            ..
        }
    ));

    // 同じ now で再 tick → 再発火しない（一回性）。
    engine.tick(0.6, &[], &mut events);
    assert!(events.is_empty());

    // now=1.6 → cue1 接近。
    engine.tick(1.6, &[], &mut events);
    assert!(matches!(
        events[0],
        Event::CueApproach {
            cue_index: 1,
            kind: 1,
            ..
        }
    ));
}

#[test]
fn cue_approach_order_within_single_tick() {
    // 新規エンジンで一気に now=2.0 → 両キューが 1 tick で接近。順序は cue0→cue1。
    let chart = chart_from_targets(&[(1.0, 0), (2.0, 1)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 0.5);
    let mut events = Vec::new();
    engine.tick(2.0, &[], &mut events);
    let approaches: Vec<u32> = events
        .iter()
        .filter_map(|e| match e {
            Event::CueApproach { cue_index, .. } => Some(*cue_index),
            _ => None,
        })
        .collect();
    assert_eq!(approaches, vec![0, 1]);
}

/// 決定論検証用: 一連のフレームを流してイベント列を集約する。
fn run_frames(chart: Chart, frames: &[(f64, Vec<Input>)]) -> (Vec<Event>, crate::Stats) {
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut collected = Vec::new();
    let mut events = Vec::new();
    for (now, inputs) in frames {
        engine.tick(*now, inputs, &mut events);
        collected.extend_from_slice(&events);
    }
    (collected, engine.stats().clone())
}

#[test]
fn deterministic_same_inputs_same_events() {
    let targets = [(1.0, 0u16), (2.0, 1), (3.0, 0), (4.0, 1)];
    let frames: Vec<(f64, Vec<Input>)> = vec![
        (0.5, vec![]),
        (1.02, vec![tap(1.01)]), // cue0 +10
        (2.06, vec![tap(2.05)]), // cue1 +50 safe
        (3.5, vec![tap(2.98)]),  // cue2 -20
        (5.0, vec![]),           // cue3 auto-miss
    ];

    let (ev_a, st_a) = run_frames(chart_from_targets(&targets, 6.0), &frames);
    let (ev_b, st_b) = run_frames(chart_from_targets(&targets, 6.0), &frames);

    assert_eq!(ev_a, ev_b, "同一入力列 → 同一イベント列");
    assert_eq!(st_a.just, st_b.just);
    assert_eq!(st_a.safe, st_b.safe);
    assert_eq!(st_a.miss, st_b.miss);
    assert_eq!(st_a.mean_ms.to_bits(), st_b.mean_ms.to_bits());
    assert_eq!(st_a.std_ms.to_bits(), st_b.std_ms.to_bits());
    assert_eq!(st_a.histogram, st_b.histogram);
    // 内容の妥当性も軽く確認。
    assert_eq!(st_a.just, 2); // +10, -20
    assert_eq!(st_a.safe, 1); // +50
    assert_eq!(st_a.miss, 1); // cue3
}

// ---------------------------------------------------------------------------
// Stats 検算（既知データ）
// ---------------------------------------------------------------------------

#[test]
fn stats_known_values() {
    // 5 キュー。誤差 5, -5, 22, 65 を与え、5 個目はオートミス。
    // 誤差はすべて bin 中央付近（10 の倍数を避ける）にして fp ノイズに強くする。
    let targets = [(1.0, 0u16), (2.0, 0), (3.0, 0), (4.0, 0), (5.0, 0)];
    let chart = chart_from_targets(&targets, 8.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();

    engine.tick(0.5, &[], &mut events); // 接近消化
    engine.tick(1.1, &[tap(1.0 + 5.0 / 1000.0)], &mut events); // +5   just
    engine.tick(2.1, &[tap(2.0 - 5.0 / 1000.0)], &mut events); // -5   just
    engine.tick(3.1, &[tap(3.0 + 22.0 / 1000.0)], &mut events); // +22 just
    engine.tick(4.1, &[tap(4.0 + 65.0 / 1000.0)], &mut events); // +65 safe
    engine.tick(6.0, &[], &mut events); // cue5 auto-miss (now>5.1)

    let s = engine.stats();
    assert_eq!(s.total_cues, 5);
    assert_eq!(s.judged, 5);
    assert_eq!(s.just, 3);
    assert_eq!(s.safe, 1);
    assert_eq!(s.miss, 1);

    // mean = (5 - 5 + 22 + 65) / 4 = 21.75
    assert!(approx(s.mean_ms, 21.75, 1e-6), "mean={}", s.mean_ms);
    // 母標準偏差 = sqrt(E[x^2] - mean^2)
    //   E[x^2] = (25 + 25 + 484 + 4225)/4 = 1189.75
    //   var = 1189.75 - 21.75^2 = 716.6875 → std = 26.77102...
    assert!(approx(s.std_ms, 26.771020, 1e-5), "std={}", s.std_ms);

    // histogram: 誤差 -5→bin9, 5→bin10, 22→bin12, 65→bin16。Miss は不算入。
    let mut expected = [0u32; 20];
    expected[9] = 1;
    expected[10] = 1;
    expected[12] = 1;
    expected[16] = 1;
    assert_eq!(s.histogram, expected, "histogram={:?}", s.histogram);
    // 合計は Just+Safe = 4。
    assert_eq!(s.histogram.iter().sum::<u32>(), 4);
}

/// 誤差（ms）を厳密に構築し、単一キュー判定後のヒストグラムを返す。
fn hist_after_error(error_ms: f64) -> [u32; 20] {
    let input_time = error_ms / 1000.0;
    let chart = chart_from_targets(&[(0.0, 0)], 10.0);
    let mut engine = Engine::new(chart, JudgeConfig::default(), 1.0);
    let mut events = Vec::new();
    engine.tick(-0.5, &[], &mut events);
    engine.tick(input_time.max(-0.4), &[tap(input_time)], &mut events);
    engine.stats().histogram
}

#[test]
fn stats_histogram_clamps_extremes() {
    // ちょうど -100ms → bin0（clamp 下端）、+100ms → bin19（clamp 上端）。
    // hist_bin(+100) = floor((100+100)/10) = 20 → clamp 19。
    let lo = hist_after_error(-100.0);
    assert_eq!(lo[0], 1, "-100ms → bin0: {lo:?}");
    assert_eq!(lo.iter().sum::<u32>(), 1);

    let hi = hist_after_error(100.0);
    assert_eq!(hi[19], 1, "+100ms → bin19: {hi:?}");
    assert_eq!(hi.iter().sum::<u32>(), 1);
}
