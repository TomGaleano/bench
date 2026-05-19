export type ScatterPoint = {
  id: string;
  label?: string;
  cost: number;
  score: number;
};

type CostScatterProps = {
  points: ScatterPoint[];
  width?: number;
  height?: number;
  emptyMessage?: string;
};

function paretoOptimal(points: ScatterPoint[]): Set<string> {
  const optimal = new Set<string>();
  for (const p of points) {
    const dominated = points.some(
      (o) =>
        o !== p &&
        o.cost <= p.cost &&
        o.score >= p.score &&
        (o.cost < p.cost || o.score > p.score),
    );
    if (!dominated) optimal.add(p.id);
  }
  return optimal;
}

export function CostScatter({
  emptyMessage = "Completed experiments will plot here.",
  height = 220,
  points,
  width = 360,
}: CostScatterProps) {
  if (!points || points.length === 0) {
    return (
      <div className="scatter-empty">
        <strong>No frontier data</strong>
        <p>{emptyMessage}</p>
      </div>
    );
  }
  const pad = 28;
  const costs = points.map((p) => p.cost);
  const scores = points.map((p) => p.score);
  const xMin = 0;
  const xMax = Math.max(...costs) * 1.1 || 1;
  const yMin = Math.min(...scores) - 5;
  const yMax = Math.max(...scores) + 5;
  const pareto = paretoOptimal(points);
  const px = (v: number) => pad + ((v - xMin) / (xMax - xMin)) * (width - 2 * pad);
  const py = (v: number) => height - pad - ((v - yMin) / (yMax - yMin)) * (height - 2 * pad);
  const paretoPoints = points
    .filter((p) => pareto.has(p.id))
    .sort((a, b) => a.cost - b.cost);
  const paretoPath = paretoPoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.cost)} ${py(p.score)}`)
    .join(" ");

  return (
    <svg
      aria-label="Cost / accuracy scatter"
      className="scatter"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
    >
      <line
        stroke="var(--rule-2)"
        x1={pad}
        x2={width - pad}
        y1={height - pad}
        y2={height - pad}
      />
      <line stroke="var(--rule-2)" x1={pad} x2={pad} y1={pad} y2={height - pad} />
      {paretoPath && (
        <path
          d={paretoPath}
          fill="none"
          opacity="0.6"
          stroke="var(--accent)"
          strokeDasharray="3,3"
          strokeWidth="1.5"
        />
      )}
      <text
        fill="var(--ink-4)"
        fontFamily="var(--mono)"
        fontSize="9.5"
        textAnchor="end"
        x={width - pad}
        y={height - pad + 14}
      >
        cost / resolved →
      </text>
      <text
        fill="var(--ink-4)"
        fontFamily="var(--mono)"
        fontSize="9.5"
        textAnchor="end"
        x={pad - 6}
        y={pad - 4}
      >
        e2e %
      </text>
      {points.map((p, i) => {
        const isPareto = pareto.has(p.id);
        const cx = px(p.cost);
        const cy = py(p.score);
        return (
          <g key={p.id}>
            <circle
              cx={cx}
              cy={cy}
              fill={isPareto ? "var(--accent)" : "var(--ink)"}
              r={isPareto ? 5 : 3.5}
              stroke="var(--paper)"
              strokeWidth="2"
              style={{
                animation: `popIn 500ms ${i * 40}ms cubic-bezier(0.2,0.8,0.2,1) both`,
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
            />
            {isPareto && p.label && (
              <text fill="var(--ink)" fontFamily="var(--mono)" fontSize="10" x={cx + 8} y={cy + 3}>
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
