/* monitor-v2.jsx — Heartbeat constellation: live runs as nodes on a stage×time grid */

const STAGES = ["queued","preparing","planning","judging","implementing","evaluating","resolved"];
const STAGE_LABELS = {
  queued: "Queued", preparing: "Sandbox", planning: "Plan",
  judging: "Judge", implementing: "Implement", evaluating: "Evaluate", resolved: "Done"
};

const MON_RUNS = (() => {
  const states = ["implementing","implementing","implementing","planning","planning",
    "evaluating","resolved","resolved","judging","queued","queued",
    "preparing","resolved","implementing","planning","resolved"];
  return states.map((st, i) => {
    const m = MODELS[i % MODELS.length];
    const t = TASKS[i % TASKS.length];
    return {
      id: "r_" + (1000 + i).toString(36),
      model: m.id, modelShort: m.short,
      task: t.id, repo: t.repo, status: st,
      tokens: 1200 + (i * 1737) % 38000,
      cost: +(0.04 + (i * 0.137) % 1.6).toFixed(2),
      duration: 30 + (i * 31) % 540,
      progress: 0.1 + (i * 0.1737) % 0.85,
    };
  });
})();

function HeartbeatCanvas({ runs, focus, setFocus }) {
  // x = elapsed time (0..maxDur), y = stage band
  const maxDur = 600;
  const stageY = (s) => {
    const idx = STAGES.indexOf(s);
    return 24 + (idx + 0.5) * ((100 - 24*2/100) / STAGES.length);  // pct
  };
  return (
    <div className="mon-canvas">
      {/* Y axis stage rows */}
      <div className="mon-axis-y">
        {STAGES.map((s, i) => (
          <div key={s} className="stage" style={{
            color: focus && focus.status === s ? "var(--accent)" : "var(--ink-4)"
          }}>{STAGE_LABELS[s]}</div>
        ))}
      </div>
      {STAGES.map((s, i) => (
        <div key={s} className="mon-stage-row" style={{
          top: `${(i+1) * (100/(STAGES.length+1))}%`,
        }}/>
      ))}
      <div className="mon-axis-x">
        <span>0:00</span><span>2:30</span><span>5:00</span><span>7:30</span><span>10:00</span>
      </div>

      {/* connector lines from queued to current stage */}
      <svg style={{position:"absolute", inset: 0, width: "100%", height: "100%", pointerEvents:"none"}}>
        {runs.map((r, i) => {
          const xStart = 60 + 14;
          const xEnd   = 60 + ((r.duration/maxDur) * 100) * (window.innerWidth*0.01) - 60;
          const yEnd   = (STAGES.indexOf(r.status)+1) * (100/(STAGES.length+1));
          const xpct   = (r.duration/maxDur) * 100;
          return (
            <line key={r.id}
              x1="60" y1="14"
              x2={`calc(60px + ${xpct}% - 60px * ${xpct/100})`}
              y2={`${yEnd}%`}
              stroke="var(--rule-2)" strokeWidth="1"
              strokeDasharray={r.status==="queued"?"3,3":""}
              opacity={focus && focus.id !== r.id ? 0.15 : 0.5}/>
          );
        })}
      </svg>

      {/* Nodes */}
      {runs.map((r, i) => {
        const xpct = Math.min(96, Math.max(2, (r.duration/maxDur) * 100));
        const yIdx = STAGES.indexOf(r.status);
        const ypct = (yIdx+1) * (100/(STAGES.length+1));
        const isActive = ["planning","judging","implementing","evaluating"].includes(r.status);
        const cls = "mon-node s-" + r.status + (isActive ? " active" : "") + (focus && focus.id === r.id ? " focused":"");
        return (
          <div key={r.id}
               onClick={() => setFocus(r)}
               className={cls}
               style={{
                 left: `calc(60px + (100% - 60px) * ${xpct/100})`,
                 top: `${ypct}%`,
                 opacity: focus && focus.id !== r.id ? 0.35 : 1,
                 zIndex: focus && focus.id === r.id ? 5 : 2,
               }}>
            <div className="ring">{r.modelShort.slice(0,2).toUpperCase()}</div>
            <div className="label">
              <span style={{color:"var(--ink-2)"}}>{r.modelShort}</span>
              <span style={{color:"var(--ink-5)", margin:"0 4px"}}>·</span>
              <span style={{fontSize:10}}>{r.task.split("__")[1] || r.task}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StreamingLine({ seed, base, active }) {
  const [t, setT] = React.useState(base);
  React.useEffect(() => {
    if (!active) { setT(base); return; }
    const pool = [
      "→ str.replace(\"django/forms/fields.py\", 312, 12)",
      "→ fs.read(\"django/forms/fields.py:300-340\")",
      "Reasoning: thread parent.formats through bind()",
      "→ shell.exec(\"pytest -xvs tests/forms/test_datetime.py\")",
      "✓ 3 passed, 1 failing — recovery needed",
      "→ grep(\"DEFAULT_FORMAT\", path=\"django/\")",
      "Pattern matches existing convention for IntegerField",
    ];
    let i = 0;
    const id = setInterval(() => {
      i++;
      setT(s => (s + "\n" + pool[(seed+i) % pool.length]).split("\n").slice(-3).join("\n"));
    }, 1400);
    return () => clearInterval(id);
  }, [seed, active]);
  return <div className="stream-line">{t}<span className="caret"/></div>;
}

function PageMonitor2() {
  const [runs, setRuns] = React.useState(MON_RUNS);
  const [focus, setFocus] = React.useState(null);
  const isActive = focus && ["planning","judging","implementing","evaluating"].includes(focus.status);

  // gentle status drift: queued → preparing, planning → judging, etc.
  React.useEffect(() => {
    const id = setInterval(() => {
      setRuns(rs => rs.map(r => {
        const drift = Math.random() < 0.06;
        if (!drift) return { ...r, duration: r.duration + 2 };
        const next = STAGES[Math.min(STAGES.length-1, STAGES.indexOf(r.status)+1)];
        return { ...r, status: next, duration: r.duration + 2 };
      }));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  const counts = {};
  for (const r of runs) counts[r.status] = (counts[r.status]||0)+1;
  const active = (counts.planning||0)+(counts.judging||0)+(counts.implementing||0)+(counts.evaluating||0);
  const totalCost = runs.reduce((s,r) => s+r.cost, 0);
  const totalTok = runs.reduce((s,r) => s+r.tokens, 0);

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","experiments","exp_3a91f","monitor"]} />
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow">
              <span className="tag2 live"><span className="pip"/>live · 16 workers</span>
              <span className="faint">·</span>
              <span>exp_3a91f</span>
              <span className="faint">·</span>
              <span>started 12:23 · 08:42 elapsed</span>
            </div>
            <h1>frontier-x-cheap-impl <em>—</em> live</h1>
            <p className="lede">
              Each node is a single run. Vertical position is the stage it's in; horizontal position is elapsed time.
              Active runs pulse; completed runs settle on the top row. <span className="italic dim">Click a node to follow it live.</span>
            </p>
          </div>
          <div className="meta">
            <div><b>{active}</b> active · {counts.resolved||0} done</div>
            <div><b>${totalCost.toFixed(2)}</b> spent · ${(totalCost/runs.length).toFixed(2)} avg</div>
            <div className="row gap-6">
              <button className="btn2 sm">Pause all</button>
              <button className="btn2 sm">Cancel</button>
            </div>
          </div>
        </div>

        <div className="mon-ribbon rise d1">
          <div className="cell"><div className="lab">Parallelism</div><div className="val">{active}<span className="dim mono" style={{fontSize:13}}>/16</span></div><div className="sub">workers active</div></div>
          <div className="cell"><div className="lab">Resolved</div><div className="val" style={{color:"var(--ok)"}}>{counts.resolved||0}</div><div className="sub">{((counts.resolved||0)/runs.length*100).toFixed(0)}% of cohort</div></div>
          <div className="cell"><div className="lab">Failed</div><div className="val" style={{color:"var(--err)"}}>{counts.failed||0}</div><div className="sub">no patch accepted</div></div>
          <div className="cell"><div className="lab">$ spent</div><div className="val">${totalCost.toFixed(2)}</div><div className="sub">of $60 cap</div></div>
          <div className="cell"><div className="lab">Tokens</div><div className="val">{(totalTok/1000).toFixed(0)}<span className="dim" style={{fontSize:14}}>k</span></div><div className="sub">{Math.round(totalTok/runs.length/1000)}k avg</div></div>
          <div className="cell"><div className="lab">Elapsed</div><div className="val shimmer-text">08:42</div><div className="sub">of 30:00 cap</div></div>
        </div>

        <div className="grid gap-16" style={{gridTemplateColumns: focus ? "1fr 360px" : "1fr"}}>
          <div className="rise d2">
            <HeartbeatCanvas runs={runs} focus={focus} setFocus={setFocus}/>
            <div className="row gap-10" style={{marginTop: 10, fontFamily:"var(--mono)", fontSize: 11, color:"var(--ink-4)"}}>
              <span><span className="pip" style={{display:"inline-block", width: 8, height: 8, background:"var(--accent)", borderRadius:"50%", marginRight:6}}/>active</span>
              <span><span className="pip" style={{display:"inline-block", width: 8, height: 8, background:"var(--ok)", borderRadius:"50%", marginRight:6}}/>resolved</span>
              <span><span className="pip" style={{display:"inline-block", width: 8, height: 8, background:"var(--err)", borderRadius:"50%", marginRight:6}}/>failed</span>
              <span className="right">node position = (stage, elapsed time)</span>
            </div>
          </div>
          {focus && (
            <div className="mon-detail rise">
              <div className="row gap-8">
                <span className={"tag2 " + (isActive?"live":"")}><span className="pip"/>{focus.status}</span>
                <span className="mono dimer">{focus.id}</span>
                <button className="btn2 sm right" onClick={() => setFocus(null)}>✕</button>
              </div>
              <div className="ti">{focus.task.split("__")[1] || focus.task}</div>
              <div className="mono dimer" style={{fontSize:11}}>{focus.modelShort} · {focus.repo}</div>
              <div className="divider"/>
              <div className="grid g2 gap-8" style={{fontFamily:"var(--mono)", fontSize:11.5}}>
                <div><div className="dimer" style={{fontSize:10}}>COST</div><div style={{fontSize:14}}>${focus.cost.toFixed(2)}</div></div>
                <div><div className="dimer" style={{fontSize:10}}>TOKENS</div><div style={{fontSize:14}}>{(focus.tokens/1000).toFixed(1)}k</div></div>
                <div><div className="dimer" style={{fontSize:10}}>ELAPSED</div><div style={{fontSize:14}}>{Math.floor(focus.duration/60)}:{String(focus.duration%60).padStart(2,"0")}</div></div>
                <div><div className="dimer" style={{fontSize:10}}>TURN</div><div style={{fontSize:14}}>{Math.floor(focus.duration/15)}/50</div></div>
              </div>
              <div className="divider"/>
              <div style={{fontFamily:"var(--mono)", fontSize:10, color:"var(--ink-4)", textTransform:"uppercase", letterSpacing:"0.07em"}}>Live trace</div>
              <StreamingLine seed={focus.id.charCodeAt(2)} base={"→ fs.read(\"django/forms/fields.py:300-340\")\nReasoning: locate DateTimeField.bind()"} active={isActive}/>
              <div className="row gap-6">
                <a href="replay.html" className="btn2 sm">Open replay →</a>
                <button className="btn2 sm">Cancel run</button>
              </div>
            </div>
          )}
        </div>

        {/* small ranked feed */}
        <div className="section-h"><span className="num">02</span> Recent <em>completions</em></div>
        <div className="card2">
          {runs.filter(r => r.status === "resolved" || r.status === "failed").slice(0, 8).map((r, i) => (
            <div key={r.id} className="row gap-12" style={{padding:"12px 18px", borderBottom: i < 7 ? "1px solid var(--rule)" : "none"}}>
              <span className={"tag2 " + (r.status === "resolved" ? "ok" : "err")}>{r.status}</span>
              <span className="mono dimer" style={{fontSize:11}}>{r.id}</span>
              <span style={{fontWeight: 500, fontSize: 13.5}}>{r.modelShort}</span>
              <span className="mono dim" style={{fontSize:11.5}}>{r.task}</span>
              <span className="right mono" style={{fontSize:11.5}}>${r.cost.toFixed(2)} · {(r.tokens/1000).toFixed(1)}k tok · {Math.floor(r.duration/60)}:{String(r.duration%60).padStart(2,"0")}</span>
              <a href="replay.html" className="btn2 sm">Replay →</a>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

window.PageMonitor2 = PageMonitor2;
