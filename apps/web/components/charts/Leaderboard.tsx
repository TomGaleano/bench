import { Sparkline } from "../ui/Sparkline";
import type { LeaderboardRow } from "../../lib/api";

type LeaderboardProps = {
  rows: LeaderboardRow[];
};

export function Leaderboard({ rows }: LeaderboardProps) {
  if (!rows || rows.length === 0) {
    return (
      <div className="lb-empty">
        <strong>No leaderboard rows yet</strong>
        <p>Launch an experiment to populate scores, costs, and model trends.</p>
      </div>
    );
  }

  const planMax = Math.max(...rows.map((r) => r.plan), 1);
  const implMax = Math.max(...rows.map((r) => r.impl), 1);
  const e2eMax = Math.max(...rows.map((r) => r.e2e), 1);

  return (
    <div className="lb">
      <div className="lb-row head">
        <div>#</div>
        <div>Model</div>
        <div>Plan</div>
        <div>Implement</div>
        <div>End-to-end</div>
        <div>$/task</div>
        <div>$/resolved</div>
        <div style={{ textAlign: "right" }}>6wk</div>
      </div>
      {rows.map((r, i) => (
        <div key={r.modelId} className={"lb-row" + (i === 0 ? " lead" : "")}>
          <div className="lb-rank">{String(r.rank).padStart(2, "0")}</div>
          <div className="lb-model">
            <span className="name">{r.modelId}</span>
            <span className="vendor">{r.harness ?? "—"}</span>
          </div>
          <Bar value={r.plan} max={planMax} delay={i * 40} />
          <Bar value={r.impl} max={implMax} delay={i * 40 + 60} />
          <Bar value={r.e2e} max={e2eMax} delay={i * 40 + 120} highlight={i === 0} />
          <div className="lb-cost">${r.costPerTask.toFixed(2)}</div>
          <div className="lb-cost">${r.costPerResolved.toFixed(2)}</div>
          <div style={{ textAlign: "right" }}>
            <Sparkline
              data={r.trend6w}
              color={i === 0 ? "var(--accent)" : "var(--ink-3)"}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Bar({
  delay,
  highlight,
  max,
  value,
}: {
  delay: number;
  highlight?: boolean;
  max: number;
  value: number;
}) {
  return (
    <div className={"bar2" + (highlight ? " accent" : "")}>
      <span className="v" style={{ color: highlight ? "var(--accent)" : "var(--ink)" }}>
        {value.toFixed(1)}
      </span>
      <span className="track">
        <i
          style={{
            width: `${(value / max) * 100}%`,
            animationDelay: `${delay}ms`,
          }}
        />
      </span>
    </div>
  );
}
