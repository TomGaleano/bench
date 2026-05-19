type SparklineProps = {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
  fill?: boolean;
};

export function Sparkline({ color = "currentColor", data, fill = false, h = 22, w = 80 }: SparklineProps) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const dx = w / (data.length - 1);
  const pts = data.map((v, i): [number, number] => [i * dx, h - ((v - min) / range) * h]);
  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1] ?? [w, h];

  return (
    <svg
      aria-hidden="true"
      className="spark"
      height={h}
      style={{ color }}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
    >
      {fill && <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="currentColor" opacity="0.08" />}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  );
}
