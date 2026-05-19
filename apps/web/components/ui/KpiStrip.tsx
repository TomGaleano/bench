import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";

export type KpiCellData = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: { direction: "up" | "down"; label: string } | null;
  spark?: number[] | undefined;
  sparkColor?: string;
  sparkFill?: boolean;
};

export function KpiStrip({ cells }: { cells: KpiCellData[] }) {
  return (
    <div className="kpi-strip">
      {cells.map((c, i) => (
        <KpiCell key={i} {...c} />
      ))}
    </div>
  );
}

export function KpiCell({ delta, label, spark, sparkColor, sparkFill, sub, value }: KpiCellData) {
  return (
    <div className="kpi-cell">
      <div className="kpi-lab">{label}</div>
      <div className="kpi-val">{value}</div>
      {(sub || delta) && (
        <div className="kpi-sub">
          {sub && <span>{sub}</span>}
          {delta && (
            <span className={`kpi-delta ${delta.direction}`}>
              {delta.direction === "up" ? "▲" : "▼"} {delta.label}
            </span>
          )}
        </div>
      )}
      {spark && spark.length > 1 && (
        <div className="kpi-spark" style={{ color: sparkColor ?? "var(--accent)" }}>
          <Sparkline data={spark} fill={sparkFill ?? false} />
        </div>
      )}
    </div>
  );
}
