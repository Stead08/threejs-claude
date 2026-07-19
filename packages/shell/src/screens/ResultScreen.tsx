// リザルト画面。resultJson（statsJson）を parse し、just/safe/miss・mean±σ・ランクを表示する。

import type { ReactElement } from "react";
import { theme } from "../theme";
import { useShellStore } from "../store";
import { parseStats } from "../parse-stats";
import { PERFECT_LABEL, RANK_LABELS, rank } from "../rank";
import { HapticButton } from "../HapticButton";

export interface ResultScreenProps {
  onRetry: () => void;
}

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        padding: "6px 0",
        fontSize: "4.2vw",
      }}
    >
      <span style={{ color: theme.fgDim }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export function ResultScreen({ onRetry }: ResultScreenProps): ReactElement {
  const resultJson = useShellStore((s) => s.resultJson);
  const openSettings = useShellStore((s) => s.openSettings);
  const stats = resultJson === null ? null : parseStats(resultJson);

  const containerStyle = {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "24px",
    background: theme.bg,
    color: theme.fg,
    fontFamily: "system-ui, sans-serif",
    textAlign: "center",
    pointerEvents: "auto",
  } as const;

  if (stats === null) {
    return (
      <div style={containerStyle}>
        <span style={{ fontSize: "4.5vw", color: theme.fgDim }}>結果を取得できませんでした</span>
        <RetryButton onRetry={onRetry} />
      </div>
    );
  }

  const { rank: grade, perfect } = rank(stats);

  return (
    <div style={containerStyle}>
      <span style={{ fontSize: "4vw", color: theme.fgDim, letterSpacing: "0.1em" }}>RESULT</span>
      {perfect ? (
        <span
          style={{
            fontSize: "4.5vw",
            fontWeight: 700,
            color: theme.accent,
            padding: "4px 16px",
            borderRadius: "999px",
            border: `1px solid ${theme.accent}`,
          }}
        >
          {PERFECT_LABEL}
        </span>
      ) : null}
      <span style={{ fontSize: "11vw", fontWeight: 800, color: theme.accent }}>
        {RANK_LABELS[grade]}
      </span>

      <div
        style={{
          width: "80vw",
          maxWidth: "420px",
          marginTop: "12px",
          padding: "16px 20px",
          borderRadius: "16px",
          background: theme.bgPanel,
        }}
      >
        <StatRow label="ぴったり" value={String(stats.just)} color={theme.accent} />
        <StatRow label="セーフ" value={String(stats.safe)} color={theme.safe} />
        <StatRow label="ミス" value={String(stats.miss)} color={theme.danger} />
        <StatRow
          label="平均誤差 ± σ"
          value={`${stats.meanMs.toFixed(1)} ± ${stats.stdMs.toFixed(1)} ms`}
          color={theme.fg}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginTop: "24px",
          width: "80vw",
          maxWidth: "420px",
        }}
      >
        <RetryButton onRetry={onRetry} />
        <HapticButton
          onClick={openSettings}
          style={{
            padding: "10px",
            borderRadius: "999px",
            border: `1px solid ${theme.border}`,
            background: "transparent",
            color: theme.fgDim,
            fontSize: "3.8vw",
          }}
        >
          設定
        </HapticButton>
      </div>
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <HapticButton
      onClick={onRetry}
      style={{
        padding: "14px",
        borderRadius: "999px",
        border: `2px solid ${theme.accent}`,
        background: theme.bgPanelAlt,
        color: theme.fg,
        fontSize: "5vw",
        fontWeight: 700,
      }}
    >
      もういちど
    </HapticButton>
  );
}
