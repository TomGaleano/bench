/* experiment-v2.jsx — visual matrix configurator */

function PageExperiment2() {
  const [models, setModels] = React.useState(new Set(MODELS.slice(0,6).map(m=>m.id)));
  const [tasks, setTasks]   = React.useState(new Set(TASKS.map(t=>t.id)));
  const [harness, setHarness] = React.useState("pi-react/1.4·50t");
  const totalRuns = models.size * tasks.size;
  const estCost = totalRuns * 0.31;

  const toggle = (set, setter, id) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
  };

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","experiments","new"]}/>
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow"><span>step 3 · configure</span><span className="faint">·</span><span>exp_draft_4d2</span></div>
            <h1>Compose an <em>experiment</em>.</h1>
            <p className="lede">Each cell on the right is one run. Toggle models on the rows and tasks on the columns. The cost meter updates as you go.</p>
          </div>
          <div className="meta">
            <div><b>{totalRuns}</b> runs</div>
            <div><b>${estCost.toFixed(2)}</b> est · ~32m</div>
            <button className="btn2 accent" style={{marginTop:8, padding:"9px 16px", fontSize: 13}}>Launch experiment →</button>
          </div>
        </div>

        <div className="grid gap-16" style={{gridTemplateColumns:"1fr 1fr"}}>
          <div className="card2 rise d1" style={{padding:"22px 24px"}}>
            <div className="card2-ti">Models · {models.size} selected</div>
            <div className="col gap-6" style={{marginTop: 12}}>
              {MODELS.slice(0,12).map(m => {
                const on = models.has(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(models, setModels, m.id)}
                    className="row gap-10"
                    style={{padding:"10px 12px", border:"1px solid "+(on?"var(--ink)":"var(--rule)"),
                            borderRadius: 8, background: on?"var(--paper-2)":"var(--paper)",
                            cursor:"pointer", textAlign:"left"}}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 4,
                      background: on?"var(--ink)":"var(--paper)",
                      border: "1.5px solid "+(on?"var(--ink)":"var(--rule-3)"),
                      display:"grid", placeItems:"center", color:"white", fontSize: 9, fontFamily:"var(--mono)",
                    }}>{on?"✓":""}</div>
                    <div className="col">
                      <span style={{fontSize: 13, fontWeight: 500}}>{m.id}</span>
                      <span className="mono dimer" style={{fontSize: 10.5}}>{m.vendor} · ${m.cost_in.toFixed(2)} in / ${m.cost_out.toFixed(2)} out per Mtok</span>
                    </div>
                    <div className="right mono dim" style={{fontSize: 11}}>~${(0.31).toFixed(2)}/run</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rise d2 col gap-16">
            <div className="card2" style={{padding:"22px 24px"}}>
              <div className="card2-ti">Run matrix · {totalRuns} cells</div>
              <div className="dim mono" style={{fontSize:10.5, marginTop: 4}}>each cell = one model × task run</div>
              <div className="matrix-grid" style={{marginTop: 14}}>
                <div className="head"></div>
                {TASKS.slice(0,8).map((t,i) => <div key={t.id} className="head" style={{textAlign:"center"}}>{i+1}</div>)}
                {MODELS.slice(0,12).filter(m => models.has(m.id)).map(m => (
                  <React.Fragment key={m.id}>
                    <div style={{fontFamily:"var(--mono)", fontSize:10.5, padding:"6px 4px", color:"var(--ink-2)"}}>{m.short}</div>
                    {TASKS.slice(0,8).map(t => {
                      const on = tasks.has(t.id);
                      return (
                        <div key={t.id} className={"matrix-cell " + (on?"on":"off")}
                             onClick={() => toggle(tasks, setTasks, t.id)}
                             title={`${m.short} × ${t.id}`}/>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
              <div className="row gap-8" style={{marginTop: 14, fontFamily:"var(--mono)", fontSize: 11, color:"var(--ink-4)"}}>
                <span>showing 8 of {TASKS.length} columns ·</span>
                <button className="btn2 sm">All</button><button className="btn2 sm">Hard only</button><button className="btn2 sm">django/*</button>
              </div>
            </div>

            <div className="card2" style={{padding:"18px 22px"}}>
              <div className="card2-ti">Harness</div>
              <div className="row gap-6" style={{marginTop: 10, flexWrap:"wrap"}}>
                {["pi-react/1.4·50t","pi-react/1.4·30t","pi-plan+impl·0.9","pi-react/1.3·50t"].map(h => (
                  <button key={h} className={"btn2 sm" + (h===harness?" primary":"")} onClick={()=>setHarness(h)}>{h}</button>
                ))}
              </div>
              <div className="grid g3 gap-12" style={{marginTop: 16}}>
                {[["Budget cap","$60.00"],["Parallelism","16 workers"],["Seed","42"]].map(([k,v]) => (
                  <div key={k} className="col">
                    <div className="mono dimer" style={{fontSize:10}}>{k.toUpperCase()}</div>
                    <div className="serif" style={{fontSize: 22, marginTop: 4}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card2" style={{padding: "14px 18px"}}>
              <div className="card2-ti">Preflight</div>
              <div className="col gap-4" style={{marginTop: 10, fontSize: 12}}>
                {[
                  ["✓","API keys validated","ok"],
                  ["✓","Worker pool: 16 / 24 capacity","ok"],
                  ["✓","Sandbox image cached locally","ok"],
                  ["⚠","claude-opus-4.1 will spend ~$48 alone","warn"],
                ].map(([s,t,k],i) => (
                  <div key={i} className="row gap-8">
                    <span className="mono" style={{color: k==="warn"?"var(--warn)":"var(--ok)"}}>{s}</span>
                    <span className="dim">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

window.PageExperiment2 = PageExperiment2;
