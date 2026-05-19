/* experiment.jsx — Page 2: New experiment wizard */

function StepDot({ i, label, current, done }) {
  return (
    <div style={{display:"flex", alignItems:"center", gap: 8}}>
      <div style={{
        width: 22, height: 22, borderRadius:"50%",
        display:"grid", placeItems:"center",
        background: done ? "var(--accent)" : current ? "var(--bg-3)" : "var(--bg-2)",
        border: "1px solid " + (current ? "var(--accent-line)" : "var(--line-2)"),
        color: done ? "#1a1100" : current ? "var(--accent)" : "var(--fg-3)",
        fontFamily:"var(--mono)", fontSize: 11, fontWeight: 500,
      }}>{done ? "✓" : i+1}</div>
      <span style={{color: current || done ? "var(--fg)" : "var(--fg-3)", fontSize: 12, fontWeight: current ? 500 : 400}}>{label}</span>
    </div>
  );
}

function Stepper({ step, steps }) {
  return (
    <div className="card" style={{padding:"12px 16px", display:"flex", alignItems:"center", gap: 24}}>
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <StepDot i={i} label={label} current={i===step} done={i<step} />
          {i < steps.length-1 && <div style={{flex:1, height:1, background:"var(--line-2)"}} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function FieldGroup({ label, hint, children }) {
  return (
    <div style={{display:"flex", flexDirection:"column", gap: 6, marginBottom: 16}}>
      <div style={{display:"flex", alignItems:"baseline", justifyContent:"space-between"}}>
        <div style={{fontSize:12, fontWeight:500}}>{label}</div>
        {hint && <div className="mono dim2" style={{fontSize:11}}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function CheckRow({ checked, onClick, children, right }) {
  return (
    <div onClick={onClick} style={{
      display:"flex", alignItems:"center", gap: 10, padding:"8px 12px",
      background: checked ? "rgba(245,165,36,0.04)" : "transparent",
      border: "1px solid " + (checked ? "var(--accent-line)" : "var(--line)"),
      borderRadius: 6, cursor:"default", marginBottom: 4,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: 3,
        border: "1.5px solid " + (checked ? "var(--accent)" : "var(--line-3)"),
        background: checked ? "var(--accent)" : "transparent",
        display:"grid", placeItems:"center",
        color: "#1a1100", fontSize: 9, fontFamily:"var(--mono)", fontWeight:700,
      }}>{checked ? "✓" : ""}</div>
      <div style={{flex:1}}>{children}</div>
      {right}
    </div>
  );
}

function PageExperiment() {
  const [step, setStep] = React.useState(2);
  const [models, setModels] = React.useState(new Set(["claude-sonnet-4.5","gpt-5","gemini-2.5-pro","claude-haiku-4.5","gpt-5-mini","gemini-2.5-flash"]));
  const [tasks, setTasks]   = React.useState(new Set(TASKS.map(t => t.id)));
  const [harness, setHarness] = React.useState("pi-react/1.4·50t");
  const [budget, setBudget]   = React.useState("60");
  const [seed, setSeed]       = React.useState("42");
  const [parallel, setParallel] = React.useState("16");

  const totalRuns = models.size * tasks.size;
  const estCost = totalRuns * 0.31;

  return (
    <main className="main">
      <Topbar crumbs={["benchmark","experiments","new"]} />
      <PageHeader
        title="New experiment"
        sub="step 3 of 5 · plan-first sweep across 6 frontier models"
        right={
          <>
            <button className="tb-btn">Save as draft</button>
            <button className="tb-btn primary">Launch →</button>
          </>
        }
      />
      <div style={{padding:"16px 24px", display:"flex", flexDirection:"column", gap: 12}}>
        <Stepper step={step} steps={["Benchmark","Models","Tasks","Harness","Review"]} />
        <div style={{display:"grid", gridTemplateColumns:"1fr 320px", gap: 12}}>
          <div className="card" style={{padding:"16px 20px"}}>
            <FieldGroup label="Name">
              <input style={{
                background:"var(--bg-2)", border:"1px solid var(--line-2)", color:"var(--fg)",
                padding:"8px 10px", borderRadius: 6, fontFamily:"var(--mono)", fontSize: 12, outline:"none", width:"100%"
              }} defaultValue="frontier-x-cheap-impl"/>
            </FieldGroup>
            <FieldGroup label="Benchmark" hint="500 tasks · v25.04">
              <div style={{display:"flex", gap: 8}}>
                <button className="tb-btn primary" style={{padding:"6px 12px"}}>swe-bench-verified</button>
                <button className="tb-btn">swe-bench-lite</button>
                <button className="tb-btn">internal-frontier-50</button>
                <button className="tb-btn">+ custom</button>
              </div>
            </FieldGroup>
            <div className="hr" style={{margin:"16px -20px"}}/>
            <FieldGroup label="Models" hint={`${models.size} selected`}>
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap: 4}}>
                {MODELS.slice(0,12).map(m => {
                  const checked = models.has(m.id);
                  return (
                    <CheckRow key={m.id} checked={checked} onClick={() => {
                      const next = new Set(models); checked ? next.delete(m.id) : next.add(m.id); setModels(next);
                    }} right={<span className="mono dim2" style={{fontSize:10.5}}>${m.cost_in.toFixed(2)}/${m.cost_out.toFixed(2)}</span>}>
                      <div style={{fontSize:12.5}}>{m.id}</div>
                      <div className="mono dim2" style={{fontSize:10.5}}>{m.vendor}</div>
                    </CheckRow>
                  );
                })}
              </div>
            </FieldGroup>
            <div className="hr" style={{margin:"16px -20px"}}/>
            <FieldGroup label="Tasks" hint={`${tasks.size} of ${TASKS.length}`}>
              <div style={{display:"flex", gap: 6, marginBottom: 8}}>
                <button className="tb-btn">All</button>
                <button className="tb-btn">Hard only</button>
                <button className="tb-btn">django/*</button>
                <button className="tb-btn">Sample 50</button>
              </div>
              <div style={{maxHeight: 220, overflow:"auto", border:"1px solid var(--line)", borderRadius: 6}}>
                {TASKS.map(t => {
                  const checked = tasks.has(t.id);
                  return (
                    <CheckRow key={t.id} checked={checked} onClick={() => {
                      const next = new Set(tasks); checked ? next.delete(t.id) : next.add(t.id); setTasks(next);
                    }} right={<span className="mono dim2" style={{fontSize:10.5}}>{t.diff} · {t.fail}f/{t.pass}p</span>}>
                      <div className="mono" style={{fontSize:11.5}}>{t.id}</div>
                    </CheckRow>
                  );
                })}
              </div>
            </FieldGroup>
            <div className="hr" style={{margin:"16px -20px"}}/>
            <FieldGroup label="Harness">
              <div className="seg" style={{padding: 4}}>
                {["pi-react/1.4·50t","pi-react/1.4·30t","pi-plan+impl·0.9","pi-react/1.3·50t"].map(h => (
                  <button key={h} className={harness===h ? "on" : ""} onClick={()=>setHarness(h)} style={{padding:"6px 12px"}}>{h}</button>
                ))}
              </div>
            </FieldGroup>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 12}}>
              <FieldGroup label="Budget cap" hint="USD">
                <input value={budget} onChange={e=>setBudget(e.target.value)} style={{background:"var(--bg-2)", border:"1px solid var(--line-2)", color:"var(--fg)", padding:"8px 10px", borderRadius:6, fontFamily:"var(--mono)", fontSize:12, outline:"none"}}/>
              </FieldGroup>
              <FieldGroup label="Parallelism" hint="workers">
                <input value={parallel} onChange={e=>setParallel(e.target.value)} style={{background:"var(--bg-2)", border:"1px solid var(--line-2)", color:"var(--fg)", padding:"8px 10px", borderRadius:6, fontFamily:"var(--mono)", fontSize:12, outline:"none"}}/>
              </FieldGroup>
              <FieldGroup label="Seed" hint="reproducibility">
                <input value={seed} onChange={e=>setSeed(e.target.value)} style={{background:"var(--bg-2)", border:"1px solid var(--line-2)", color:"var(--fg)", padding:"8px 10px", borderRadius:6, fontFamily:"var(--mono)", fontSize:12, outline:"none"}}/>
              </FieldGroup>
            </div>
          </div>
          <div style={{display:"flex", flexDirection:"column", gap: 12}}>
            <div className="card" style={{padding:"14px 16px"}}>
              <div style={{fontSize:12, fontWeight:500, marginBottom:10}}>Preflight</div>
              {[
                ["Models",      `${models.size} selected`],
                ["Tasks",       `${tasks.size} selected`],
                ["Total runs",  fmt.num(totalRuns)],
                ["Harness",     harness],
                ["Parallelism", `${parallel} workers`],
                ["Seed",        seed],
              ].map(([k,v]) => (
                <div key={k} style={{display:"flex", justifyContent:"space-between", padding: "4px 0", fontSize:12}}>
                  <span className="mono dim">{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
              <div className="hr" style={{margin: "10px 0"}}/>
              <div className="metric" style={{padding:0}}>
                <div className="lab">EST. COST</div>
                <div className="val" style={{color:"var(--accent)"}}>${estCost.toFixed(2)}</div>
                <div className="sub">{fmt.num(totalRuns)} runs · ~$0.31/run avg · ${budget} cap</div>
              </div>
              <div className="hr" style={{margin: "10px 0"}}/>
              <div className="metric" style={{padding:0}}>
                <div className="lab">EST. WALL TIME</div>
                <div className="val">~32m</div>
                <div className="sub">at {parallel} parallel · 184s p50</div>
              </div>
            </div>
            <div className="card" style={{padding:"12px 14px", display:"flex", flexDirection:"column", gap: 8}}>
              <div style={{fontSize:12, fontWeight:500}}>Sanity checks</div>
              {[
                ["✓","API keys validated","ok"],
                ["✓","Worker pool has capacity (16/24)","ok"],
                ["✓","Sandbox image cached","ok"],
                ["⚠","claude-opus-4.1 will spend ~$48 alone","warn"],
                ["✓","Budget cap below monthly remaining ($1153)","ok"],
              ].map(([m,t,k], i) => (
                <div key={i} style={{display:"flex", gap: 8, fontSize:11.5}}>
                  <span className="mono" style={{color: k==="warn"?"var(--accent)":"var(--ok)"}}>{m}</span>
                  <span className="dim">{t}</span>
                </div>
              ))}
            </div>
            <button className="tb-btn primary" style={{padding:"10px 16px", fontSize: 13, justifyContent:"center"}}>Launch experiment →</button>
          </div>
        </div>
      </div>
    </main>
  );
}

window.PageExperiment = PageExperiment;
