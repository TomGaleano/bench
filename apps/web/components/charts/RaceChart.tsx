import { Sparkline } from "../ui/Sparkline";

export type RaceRow = {
  modelId: string;
  short: string;
  trend: number[];
};

const LANE_COLORS = ["var(--accent)", "var(--ink)", "var(--cool)", "var(--plum)", "var(--ink-4)"];

type RaceChartProps = {
  rows: RaceRow[];
  width?: number;
  height?: number;
  labels?: string[];
};

export function RaceChart({
  height = 220,
  labels = ["w-5", "w-4", "w-3", "w-2", "w-1", "now"],
  rows,
  width = 720,
}: RaceChartProps) {
  if (!rows || rows.length === 0) {
    return (
      <div className="scatter-empty" style={{ minHeight: 200 }}>
        <strong>No frontier history</strong>
        <p>Once experiments accumulate, week-over-week motion will plot here.</p>
      </div>
    );
  }
  const pad = 32;
  const allValues = rows.flatMap((r) => r.trend);
  const maxV = Math.max(...allValues);
  const minV = Math.min(...allValues);
  const range = maxV - minV || 1;
  const points = rows[0]?.trend.length ?? 6;

  return (
    <svg
      aria-label="Race chart of weekly leader scores"
      className="raceChart"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line
          key={i}
          stroke="var(--rule)"
          strokeDasharray={p === 0 || p === 1 ? "" : "2,3"}
          strokeWidth="1"
          x1={pad}
          x2={width - pad}
          y1={pad + p * (height - 2 * pad)}
          y2={pad + p * (height - 2 * pad)}
        />
      ))}
      {[0, 0.5, 1].map((p, i) => {
        const v = (maxV - p * range).toFixed(0);
        return (
          <text
            key={i}
            x={pad - 6}
            y={pad + p * (height - 2 * pad) + 3}
            textAnchor="end"
            fontFamily="var(--mono)"
            fontSize="9"
            fill="var(--ink-4)"
          >
            {v}%
          </text>
        );
      })}
      {labels.map((l, i) => {
        const x = pad + (i / (points - 1)) * (width - 2 * pad);
        return (
          <text
            key={l}
            x={x}
            y={height - 8}
            textAnchor="middle"
            fontFamily="var(--mono)"
            fontSize="9"
            fill="var(--ink-4)"
          >
            {l}
          </text>
        );
      })}
      {rows.map((r, ri) => {
        const pts = r.trend.map((v, i): [number, number] => {
          const x = pad + (i / (points - 1)) * (width - 2 * pad);
          const y = pad + (1 - (v - minV) / range) * (height - 2 * pad);
          return [x, y];
        });
        const d = pts
          .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
          .join(" ");
        const isLead = ri === 0;
        const color = LANE_COLORS[Math.min(ri, LANE_COLORS.length - 1)];
        const last = pts[pts.length - 1] ?? [width - pad, height / 2];
        return (
          <g key={r.modelId} style={{ opacity: ri < 5 ? 1 : 0.4 }}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isLead ? 2 : 1.4}
              strokeLinejoin="round"
              style={{
                strokeDasharray: 800,
                strokeDashoffset: 800,
                animation: `drawLine 1400ms ${ri * 60}ms cubic-bezier(0.2,0.8,0.2,1) forwards`,
              }}
            />
            <circle cx={last[0]} cy={last[1]} r={isLead ? 4 : 3} fill={color} />
            <text
              x={last[0] + 8}
              y={last[1] + 3}
              fontFamily="var(--mono)"
              fontSize="10"
              fill={color}
            >
              {r.short}
            </text>
          </g>
        );
      })}
      <style>{`@keyframes drawLine { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
}

export function MiniRaceTrend({ trend }: { trend: number[] }) {
  return <Sparkline data={trend} color="var(--ink-3)" />;
}
