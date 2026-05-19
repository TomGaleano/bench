/* dashboard.jsx — Page 1: Leaderboard + summary */

function MiniSpark({ data, color = "var(--accent)", w = 90, h = 24 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = Math.max(0.001, max - min);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return [x, y];
  });
  const d = "M" + pts.map(p => p.join(",")).join("L");
  const area = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path className="area" d={area} style={{ fill: "var(--accent-soft)" }} />
      <path className="line" d={d} style={{ stroke: color }} />
    </svg>
  );
}

function Pareto() {
  const W = 360, H = 220, padL = 36, padR = 14, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = LEADERBOARD.map(r => r.costRes);
  const ys = LEADERBOARD.map(r => r.e2e);
  const xMax = Math.max(...xs) * 1.05;
  const yMin = Math.min(...ys) * 0.92;
  const yMax = Math.max(...ys) * 1.04;
  const x = (v) => padL + (v / xMax) * innerW;
  const y = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  // pareto frontier (cheap & high)
  const frontier = LEADERBOARD.slice().sort((a,b) => a.costRes - b.costRes).reduce((acc, r) => {
    if (!acc.length || r.e2e > acc[acc.length-1].e2e) acc.push(r);
    return acc;
  }, []);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:"block"}}>
      {/* gridlines */}
      {[0,1,2,3,4].map(i => (
        <line key={i} x1={padL} x2={W-padR} y1={padT + (innerH * i/4)} y2={padT + (innerH * i/4)}
              stroke="var(--line)" strokeWidth="1" />
      ))}
      {/* x ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => (
        <text key={t} x={padL + t * innerW} y={H-10} fill="var(--fg-4)" fontSize="9" fontFamily="var(--mono)" textAnchor="middle">
          ${(t * xMax).toFixed(2)}
        </text>
      ))}
      {/* y ticks */}
      {[yMin, (yMin+yMax)/2, yMax].map((t, i) => (
        <text key={i} x={padL-6} y={y(t)+3} fill="var(--fg-4)" fontSize="9" fontFamily="var(--mono)" textAnchor="end">
          {t.toFixed(0)}%
        </text>
      ))}
      {/* frontier line */}
      <path d={"M" + frontier.map(r => `${x(r.costRes)},${y(r.e2e)}`).join("L")}
            stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" fill="none" opacity="0.6" />
      {/* points */}
      {LEADERBOARD.map((r, i) => {
        const isFrontier = frontier.includes(r);
        return (
          <g key={r.model}>
            <circle cx={x(r.costRes)} cy={y(r.e2e)} r={isFrontier ? 4 : 3}
                    fill={isFrontier ? "var(--accent)" : "var(--fg-3)"}
                    stroke={isFrontier ? "var(--bg)" : "none"}
                    strokeWidth="1" />
            {isFrontier && (
              <text x={x(r.costRes)+6} y={y(r.e2e)-6} fill="var(--fg-2)" fontSize="9" fontFamily="var(--mono)">
                {modelById(r.model).short}
              </text>
            )}
          </g>
        );
      })}
      {/* axis labels */}
      <text x={W/2} y={H-1} fill="var(--fg-3)" fontSize="9" fontFamily="var(--mono)" textAnchor="middle">cost / resolved →</text>
      <text x={8} y={padT+8} fill="var(--fg-3)" fontSize="9" fontFamily="var(--mono)">e2e %</text>
    </svg>
  );
}

function StackedBar({ pct = 62, segments }) {
  // segments: [{label, val, color}, ...]
  const total = segments.reduce((s, x) => s + x.val, 0);
  return (
    <div style={{display:"flex", height: 8, borderRadius: 4, overflow:"hidden", background:"var(--bg-3)"}}>
      {segments.map((s, i) => (
        <div key={i} title={`${s.label}: ${s.val}`}
             style={{ width: `${(s.val/total)*100}%`, background: s.color }} />
      ))}
    </div>
  );
}

function ActiveExpStrip() {
  const a = { id: "exp_3a91f", label: "frontier-x-cheap-impl", running: 9, queued: 23, done: 56, failed: 8, total: 96, cost: 28.41, budget: 60.0 };
  const pct = ((a.done + a.failed) / a.total) * 100;
  return (
    <div className="card" style={{padding:"12px 16px", display:"flex", alignItems:"center", gap: 16}}>
      <div style={{display:"flex", alignItems:"center", gap: 8}}>
        <span className="status-pill live s-implementing"><span className="dot"/>running</span>
        <a className="mono" href="monitor.html" style={{color:"var(--fg)", fontWeight: 500}}>{a.label}</a>
        <span className="mono dim">· {a.id}</span>
      </div>
      <div style={{flex: 1, minWidth: 200}}>
        <StackedBar segments={[
          { label:"done",     val: a.done,    color: "var(--ok)" },
          { label:"failed",   val: a.failed,  color: "var(--err)" },
          { label:"running",  val: a.running, color: "var(--accent)" },
          { label:"queued",   val: a.queued,  color: "var(--bg-4)" },
        ]} />
        <div style={{display:"flex", gap: 12, marginTop: 6, fontFamily:"var(--mono)", fontSize: 11, color:"var(--fg-3)"}}>
          <span><span style={{color:"var(--ok)"}}>●</span> {a.done} done</span>
          <span><span style={{color:"var(--err)"}}>●</span> {a.failed} failed</span>
          <span><span style={{color:"var(--accent)"}}>●</span> {a.running} running</span>
          <span><span style={{color:"var(--fg-4)"}}>●</span> {a.queued} queued</span>
          <span style={{marginLeft:"auto"}}>{Math.round(pct)}% · {fmt.cost(a.cost)} / {fmt.cost(a.budget)}</span>
        </div>
      </div>
      <a href="monitor.html" className="tb-btn" style={{textDecoration:"none"}}>Open monitor →</a>
    </div>
  );
}

function MetricCards() {
  const cards = [
    { lab:"BEST E2E SCORE",     val:"54.6%",  sub:"claude-opus-4.1",   delta:"+1.4 wk", up:true },
    { lab:"BEST PLAN SCORE",    val:"81.2%",  sub:"claude-opus-4.1",   delta:"+2.4 wk", up:true },
    { lab:"BEST $ / RESOLVED",  val:"$0.10",  sub:"gemini-2.5-flash",  delta:"−4.2%",   up:true },
    { lab:"FASTEST P50",        val:"71s",    sub:"gemini-2.5-flash",  delta:"−6s",     up:true },
    { lab:"RUNS COMPLETED 7D",  val:"1,842",  sub:"+312 vs prior wk",  delta:"+20.4%",  up:true },
    { lab:"$ SPENT THIS MONTH", val:"$847",   sub:"of $2,000 budget",  delta:"42%",     up:false },
  ];
  return (
    <div style={{display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap: 10}}>
      {cards.map(c => (
        <div key={c.lab} className="card metric">
          <div className="lab">{c.lab}</div>
          <div className="val">{c.val}</div>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <div className="sub">{c.sub}</div>
            <div className="delta" style={{color: c.up ? "var(--ok)" : "var(--fg-3)"}}>{c.delta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaderboardTable() {
  const [sort, setSort] = React.useState({ key: "e2e", dir: -1 });
  const [filter, setFilter] = React.useState("all");
  const sorted = [...LEADERBOARD].sort((a,b) => (a[sort.key] - b[sort.key]) * sort.dir);
  const click = (k) => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }));
  const arrow = (k) => sort.key === k ? (sort.dir < 0 ? "↓" : "↑") : "";
  return (
    <div className="card">
      <div style={{display:"flex", alignItems:"center", padding:"10px 14px", gap: 10, borderBottom:"1px solid var(--line)"}}>
        <div style={{fontWeight:500, fontSize:13}}>Leaderboard</div>
        <span className="mono dim2" style={{fontSize:11}}>· {LEADERBOARD.length} models · 500 tasks · swe-bench-verified-v25.04</span>
        <div style={{flex:1}} />
        <div className="seg">
          <button className={filter==="all" ? "on": ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter==="frontier" ? "on": ""} onClick={() => setFilter("frontier")}>Frontier</button>
          <button className={filter==="cheap" ? "on": ""} onClick={() => setFilter("cheap")}>Cost-efficient</button>
        </div>
        <button className="tb-btn">Compare</button>
      </div>
      <div style={{overflow:"auto", maxHeight: 480}}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width: 28}}>#</th>
              <th>Model</th>
              <th>Harness</th>
              <th className="r" onClick={() => click("plan")} style={{cursor:"pointer"}}>Plan {arrow("plan")}</th>
              <th className="r" onClick={() => click("impl")} style={{cursor:"pointer"}}>Impl {arrow("impl")}</th>
              <th className="r" onClick={() => click("e2e")} style={{cursor:"pointer"}}>E2E {arrow("e2e")}</th>
              <th className="r" onClick={() => click("delta")} style={{cursor:"pointer"}}>Δ wk {arrow("delta")}</th>
              <th className="r cost-col">$ / task</th>
              <th className="r cost-col">$ / resolved</th>
              <th className="r" onClick={() => click("lat")} style={{cursor:"pointer"}}>p50 {arrow("lat")}</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const isLeader = i === 0;
              return (
                <tr key={r.model}>
                  <td className="num" style={{color: isLeader ? "var(--accent)" : "var(--fg-3)"}}>{i+1}</td>
                  <td>
                    <a href="replay.html" style={{display:"flex", alignItems:"center", gap:8}}>
                      <span style={{display:"inline-block", width:6, height:6, borderRadius:"50%", background: modelById(r.model).vendor === "Anthropic" ? "var(--accent)" : modelById(r.model).vendor === "OpenAI" ? "var(--teal)" : modelById(r.model).vendor === "Google" ? "var(--info)" : "var(--violet)"}} />
                      <span style={{fontWeight: isLeader ? 500 : 400}}>{r.model}</span>
                    </a>
                  </td>
                  <td className="mono dim2" style={{fontSize:11}}>{r.harness}</td>
                  <td className="r num">{r.plan.toFixed(1)}%</td>
                  <td className="r num">{r.impl.toFixed(1)}%</td>
                  <td className="r num" style={{color: isLeader ? "var(--accent)" : "var(--fg)"}}>{r.e2e.toFixed(1)}%</td>
                  <td className="r num"><span style={{color: r.delta >= 0 ? "var(--ok)" : "var(--err)"}}>{r.delta >= 0 ? "+" : ""}{r.delta.toFixed(1)}</span></td>
                  <td className="r num cost-col">{fmt.cost(r.costTask)}</td>
                  <td className="r num cost-col">{fmt.cost(r.costRes)}</td>
                  <td className="r num">{r.lat}s</td>
                  <td><MiniSpark data={r.trend} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageDashboard() {
  return (
    <main className="main">
      <Topbar crumbs={["benchmark","dashboard"]} />
      <PageHeader
        title="SWE-bench Verified"
        sub="500 tasks · v25.04 · last sync 2m ago"
        right={
          <>
            <span className="mono" style={{fontSize:11, color:"var(--fg-3)"}}>filter:</span>
            <button className="tb-btn">family: all ▾</button>
            <button className="tb-btn">harness: pi-react/1.4 ▾</button>
            <button className="tb-btn">window: 7d ▾</button>
          </>
        }
      />
      <div className="page" style={{padding:"16px 24px", gap: 12, display:"flex", flexDirection:"column"}}>
        <ActiveExpStrip />
        <MetricCards />
        <div style={{display:"grid", gridTemplateColumns:"1fr 380px", gap: 12}}>
          <LeaderboardTable />
          <div className="card" style={{padding: 14}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div style={{fontWeight:500, fontSize:13}}>Cost vs E2E score</div>
              <span className="mono dim2" style={{fontSize:10}}>pareto frontier</span>
            </div>
            <div style={{marginTop: 10}}><Pareto /></div>
            <div className="hr" style={{margin:"14px 0"}}/>
            <div style={{display:"flex", flexDirection:"column", gap: 8}}>
              <div style={{fontSize: 12, fontWeight:500}}>Notable shifts (7d)</div>
              {[
                ["claude-sonnet-4.5", "+2.1% e2e", "var(--ok)"],
                ["gemini-2.5-flash", "−4.2% $/resolved", "var(--ok)"],
                ["o4", "−0.3% e2e (regression)", "var(--err)"],
                ["deepseek-v3.2", "+1.2% e2e", "var(--ok)"],
              ].map(([m,d,c]) => (
                <div key={m} style={{display:"flex", justifyContent:"space-between", fontSize: 12}}>
                  <span className="mono">{m}</span>
                  <span className="mono" style={{color: c}}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

window.PageDashboard = PageDashboard;
