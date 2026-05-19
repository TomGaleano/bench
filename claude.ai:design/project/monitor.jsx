/* monitor.jsx — Page 3: Live Parallel Run Monitor (signature surface) */

const RUN_SEED = (() => {
  // build 16 stable runs
  const states = [
    "implementing","implementing","implementing","planning","planning",
    "evaluating","resolved","resolved","judging","queued","queued",
    "preparing","failed","implementing","planning","timeout"
  ];
  const out = [];
  for (let i = 0; i < 16; i++) {
    const m = MODELS[i % MODELS.length];
    const t = TASKS[i % TASKS.length];
    const st = states[i];
    out.push({
      id: "r_" + (1000 + i).toString(36),
      model: m.id,
      modelShort: m.short,
      task: t.id,
      repo: t.repo,
      status: st,
      tokens: 1200 + (i * 1737) % 38000,
      cost: +(0.04 + (i * 0.137) % 1.6).toFixed(2),
      duration: 30 + (i * 31) % 540,
      filesTouched: st === "queued" || st === "preparing" ? 0 : 1 + (i % 5),
      tool: toolFor(st, i),
      stream: streamFor(st, m.short, t.id),
    });
  }
  return out;
})();

function toolFor(st, i) {
  switch (st) {
    case "queued": return null;
    case "preparing": return "git.clone";
    case "planning": return ["fs.read","grep","fs.list"][i%3];
    case "judging": return "judge.score";
    case "implementing": return ["str.replace","fs.read","shell.exec","fs.write"][i%4];
    case "evaluating": return "harness.run_tests";
    default: return null;
  }
}
function streamFor(st, m, t) {
  const base = t.split("__")[1] || t;
  switch (st) {
    case "queued":    return "// awaiting worker slot";
    case "preparing": return `cloning ${t}@base into sandbox\nresolving deps…`;
    case "planning":  return `Reading django/forms/fields.py to locate DateTimeField.bind…\nThe failing test ${base} expects format to resolve from the root schema, not the field-local override.`;
    case "judging":   return `Scoring plan against 6 gold atoms\nCoverage so far: 4/6 atoms matched.`;
    case "implementing": return `Editing django/forms/fields.py — replacing 12 lines\nApplying patch hunk @@ -312,5 +312,9 @@`;
    case "evaluating": return `pytest -xvs tests/forms/test_datetime.py::FormatResolution\n3 passed, 4 collected`;
    case "resolved":  return `7/7 FAIL_TO_PASS now passing.\nPatch accepted (47 lines, 2 files).`;
    case "failed":    return `AssertionError: expected 'Y-m-d' got '%Y-%m-%d'\n3/7 FAIL_TO_PASS still failing.`;
    case "timeout":   return `Hit 60-turn limit. No patch applied.`;
    default: return "";
  }
}

function MetricBar({ runs }) {
  const counts = {};
  for (const r of runs) counts[r.status] = (counts[r.status] || 0) + 1;
  const total = runs.length;
  const totalCost = runs.reduce((s, r) => s + r.cost, 0);
  const totalTokens = runs.reduce((s, r) => s + r.tokens, 0);
  const cards = [
    { lab:"PARALLELISM",   val: `${runs.filter(r => ["planning","judging","implementing","evaluating"].includes(r.status)).length}/16`, sub: "active workers" },
    { lab:"PROGRESS",      val: `${counts.resolved||0}+${counts.failed||0}/${total}`, sub: `${Math.round(((counts.resolved||0)+(counts.failed||0))/total*100)}% done` },
    { lab:"$ SPENT",       val: fmt.cost(totalCost), sub: "of $20 budget" },
    { lab:"TOKENS",        val: fmt.k(totalTokens), sub: `${fmt.k(Math.round(totalTokens/total))} avg` },
    { lab:"PATCH RATE",    val: `${counts.resolved||0}/${(counts.resolved||0)+(counts.failed||0)+(counts.timeout||0)||1}`, sub: "resolved / decided" },
    { lab:"ELAPSED",       val: "08:42", sub: "of 30:00 cap" },
  ];
  return (
    <div style={{display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap: 8}}>
      {cards.map(c => (
        <div key={c.lab} className="card" style={{padding:"10px 12px"}}>
          <div className="mono" style={{fontSize: 10, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".06em"}}>{c.lab}</div>
          <div style={{fontSize: 18, fontWeight: 500, marginTop: 2, fontVariantNumeric:"tabular-nums"}}>{c.val}</div>
          <div className="mono" style={{fontSize: 10.5, color:"var(--fg-3)"}}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// streaming text per card — appends chars over time
function useStreamingText(seed, base, active) {
  const [shown, setShown] = React.useState(base);
  React.useEffect(() => {
    if (!active) { setShown(base); return; }
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      const speed = (window.__streamSpeed || 1);
      i++;
      // periodically append more lines from a pool
      if (i % 6 === 0) {
        const pool = [
          "→ str.replace(\"django/forms/fields.py\", 312, 12)",
          "→ fs.read(\"django/forms/fields.py:300-340\")",
          "→ shell.exec(\"pytest -xvs tests/forms/test_datetime.py\")",
          "→ grep(\"DateTimeField\", path=\"django/\")",
          "✓ 4 occurrences in 2 files",
          "Reasoning: the root schema must thread through bind",
          "Trying alternative: pre-resolve in BoundField.value()",
          "Pattern matches existing convention for IntegerField",
          "Re-running impacted tests…",
        ];
        const line = pool[(seed + i) % pool.length];
        setShown(s => (s + "\n" + line).split("\n").slice(-4).join("\n"));
      }
      setTimeout(tick, 350 / Math.max(0.1, speed));
    };
    setTimeout(tick, 600);
    return () => { cancelled = true; };
  }, [seed, active]);
  return shown;
}

function RunCard({ run, onOpen }) {
  const isActive = ["planning","judging","implementing","evaluating"].includes(run.status);
  const stream = useStreamingText(run.id.charCodeAt(2), run.stream, isActive);
  const m = modelById(run.model);
  // ticking cost
  const [cost, setCost] = React.useState(run.cost);
  React.useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      setCost(c => +(c + 0.001 * (window.__streamSpeed || 1)).toFixed(3));
    }, 700);
    return () => clearInterval(id);
  }, [isActive]);
  return (
    <div className={"run-card s-" + run.status} onClick={() => onOpen?.(run)}>
      <div className="rc-hd">
        <span className={"status-pill s-" + run.status + (isActive ? " live" : "")}>
          <span className="dot" /> {run.status}
        </span>
        <span className="model">{run.modelShort}</span>
        <span className="dim2" style={{marginLeft:"auto"}}>{run.id}</span>
      </div>
      <div className="rc-task" title={run.task}>{run.task}</div>
      <div className="rc-stream">{stream}</div>
      <div className="rc-foot">
        {run.tool && <span className="tool-pill">{run.tool}</span>}
        <span className="right">
          <span className="cost-meter">{fmt.cost(cost)} · </span>
          <span>{fmt.k(run.tokens)} tok · </span>
          <span>{Math.floor(run.duration/60)}:{String(run.duration%60).padStart(2,"0")}</span>
        </span>
      </div>
    </div>
  );
}

function MonitorGrid({ runs, onOpen }) {
  return <div className="run-grid">{runs.map(r => <RunCard key={r.id} run={r} onOpen={onOpen}/>)}</div>;
}

function MonitorLane({ runs, onOpen }) {
  const lanes = ["queued","preparing","planning","judging","implementing","evaluating","resolved","failed"];
  return (
    <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap: 10}}>
      {lanes.map(lane => {
        const inLane = runs.filter(r => r.status === lane);
        if (lane === "queued" || lane === "preparing") return null;
        return (
          <div key={lane} className="card" style={{padding:10, display:"flex", flexDirection:"column", gap: 8}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
              <span className={"status-pill s-" + lane}><span className="dot"/>{lane}</span>
              <span className="mono dim2">{inLane.length}</span>
            </div>
            {inLane.map(r => <RunCard key={r.id} run={r} onOpen={onOpen} />)}
            {!inLane.length && <div className="mono dim2" style={{padding:"20px 0", textAlign:"center", fontSize:11}}>—</div>}
          </div>
        );
      })}
    </div>
  );
}

function MonitorList({ runs, onOpen }) {
  return (
    <div className="card">
      <table className="tbl">
        <thead><tr>
          <th>Status</th><th>ID</th><th>Model</th><th>Task</th><th>Tool</th>
          <th className="r cost-col">Cost</th><th className="r">Tokens</th><th className="r">Duration</th>
        </tr></thead>
        <tbody>
          {runs.map(r => {
            const isActive = ["planning","judging","implementing","evaluating"].includes(r.status);
            return (
              <tr key={r.id} onClick={() => onOpen?.(r)} style={{cursor:"pointer"}}>
                <td><span className={"status-pill s-" + r.status + (isActive ? " live" : "")}><span className="dot"/>{r.status}</span></td>
                <td className="mono dim2">{r.id}</td>
                <td>{r.modelShort}</td>
                <td className="mono" style={{fontSize:11}}>{r.task}</td>
                <td>{r.tool && <span className="tool-pill">{r.tool}</span>}</td>
                <td className="r num cost-col">{fmt.cost(r.cost)}</td>
                <td className="r num">{fmt.k(r.tokens)}</td>
                <td className="r num">{Math.floor(r.duration/60)}:{String(r.duration%60).padStart(2,"0")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({ run, onClose }) {
  if (!run) return null;
  return (
    <>
      <div onClick={onClose} style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:30}}/>
      <aside style={{position:"fixed", top:0, right:0, width: 480, height:"100vh", background:"var(--bg-1)", borderLeft:"1px solid var(--line)", zIndex:31, padding:"16px 18px", overflow:"auto"}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <span className={"status-pill s-" + run.status + " live"}><span className="dot"/>{run.status}</span>
          <span className="mono dim2">{run.id}</span>
          <button className="tb-btn" style={{marginLeft:"auto"}} onClick={onClose}>✕</button>
        </div>
        <div style={{marginTop:10, fontSize:18, fontWeight:500}}>{run.task}</div>
        <div className="mono dim" style={{fontSize:11.5}}>{run.modelShort} · {run.repo}</div>
        <div className="hr" style={{margin:"12px 0"}}/>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8}}>
          <div className="card" style={{padding:"8px 10px"}}><div className="mono dim2" style={{fontSize:10}}>COST</div><div style={{fontSize:14, fontFamily:"var(--mono)"}}>{fmt.cost(run.cost)}</div></div>
          <div className="card" style={{padding:"8px 10px"}}><div className="mono dim2" style={{fontSize:10}}>TOKENS</div><div style={{fontSize:14, fontFamily:"var(--mono)"}}>{fmt.k(run.tokens)}</div></div>
          <div className="card" style={{padding:"8px 10px"}}><div className="mono dim2" style={{fontSize:10}}>FILES</div><div style={{fontSize:14, fontFamily:"var(--mono)"}}>{run.filesTouched}</div></div>
          <div className="card" style={{padding:"8px 10px"}}><div className="mono dim2" style={{fontSize:10}}>DURATION</div><div style={{fontSize:14, fontFamily:"var(--mono)"}}>{Math.floor(run.duration/60)}:{String(run.duration%60).padStart(2,"0")}</div></div>
        </div>
        <div className="hr" style={{margin:"12px 0"}}/>
        <div style={{fontSize:12, fontWeight:500, marginBottom: 6}}>Live event log</div>
        <div className="card evt-log">
          {[
            ["12:31:02","tool","fs.read","django/forms/fields.py:0-200"],
            ["12:31:04","text","assistant","Looking at DateTimeField.bind…"],
            ["12:31:08","tool","grep","'root_schema' in django/"],
            ["12:31:09","tool","fs.read","django/db/models/fields/__init__.py:1100-1200"],
            ["12:31:12","text","assistant","The schema arrives via parent.format(), but the bound field never reads it back."],
            ["12:31:18","tool","str.replace","django/forms/fields.py @ 312"],
            ["12:31:19","text","assistant","Re-running tests/forms/test_datetime.py…"],
            ["12:31:24","tool","shell.exec","pytest -xvs tests/forms/test_datetime.py"],
            ["12:31:32","text","assistant","3 passed, 4 collected — 1 still failing."],
          ].map((e, i) => (
            <div key={i} className={"evt " + (e[1] === "tool" ? "tool" : "")}>
              <span className="t">{e[0]}</span>
              <span className="k">{e[2]}</span>
              <span className="v">{e[3]}</span>
            </div>
          ))}
        </div>
        <div className="hr" style={{margin:"12px 0"}}/>
        <div style={{display:"flex", gap: 8}}>
          <a className="tb-btn primary" href="replay.html">Open replay →</a>
          <button className="tb-btn">Cancel run</button>
        </div>
      </aside>
    </>
  );
}

function PageMonitor() {
  const [runs] = React.useState(RUN_SEED);
  const [view, setView] = React.useState("grid");
  React.useEffect(() => {
    const apply = () => setView(document.body.dataset.monitorView || "grid");
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-monitor-view"] });
    return () => obs.disconnect();
  }, []);
  const [open, setOpen] = React.useState(null);

  return (
    <main className="main">
      <Topbar crumbs={["benchmark","experiments","exp_3a91f","monitor"]} />
      <PageHeader
        title="frontier-x-cheap-impl"
        sub="exp_3a91f · 6 models × 16 tasks · pi-react/1.4 · started 12:23 · 08:42 elapsed"
        right={
          <>
            <span className="status-pill s-implementing live"><span className="dot"/>running</span>
            <button className="tb-btn">Pause all</button>
            <button className="tb-btn">Cancel</button>
            <button className="tb-btn primary">Open replay…</button>
          </>
        }
      />
      <div style={{padding:"16px 24px", display:"flex", flexDirection:"column", gap: 12}}>
        <MetricBar runs={runs} />
        <div className="card" style={{padding:"10px 14px", display:"flex", alignItems:"center", gap: 10}}>
          <span className="mono dim2" style={{fontSize:11}}>filter:</span>
          <button className="tb-btn">all stages ▾</button>
          <button className="tb-btn">all models ▾</button>
          <button className="tb-btn">all tasks ▾</button>
          <span style={{flex:1}}/>
          <span className="mono dim2" style={{fontSize:11}}>view:</span>
          <div className="seg">
            <button className={view==="grid" ? "on" : ""} onClick={()=>{document.body.dataset.monitorView="grid"; setView("grid");}}>Grid</button>
            <button className={view==="lane" ? "on" : ""} onClick={()=>{document.body.dataset.monitorView="lane"; setView("lane");}}>Lane</button>
            <button className={view==="list" ? "on" : ""} onClick={()=>{document.body.dataset.monitorView="list"; setView("list");}}>List</button>
          </div>
        </div>
        {view === "grid" && <MonitorGrid runs={runs} onOpen={setOpen}/>}
        {view === "lane" && <MonitorLane runs={runs} onOpen={setOpen}/>}
        {view === "list" && <MonitorList runs={runs} onOpen={setOpen}/>}
      </div>
      <Drawer run={open} onClose={() => setOpen(null)} />
    </main>
  );
}

window.PageMonitor = PageMonitor;
