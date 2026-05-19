/* planning.jsx — Page 5: Plan score detail */

const ATOMS = [
  { id: "A1", text: "Locate DateTimeField.bind() in django/forms/fields.py", required: true,  matched: true, where: "00:14" },
  { id: "A2", text: "Identify that root form's _meta.formats is the source of truth", required: true,  matched: true, where: "00:21" },
  { id: "A3", text: "Thread parent.formats through bind() with fallback to DEFAULT_FORMAT", required: true,  matched: true, where: "00:21" },
  { id: "A4", text: "Update BoundField helper to expose the resolved format", required: true,  matched: true, where: "00:21" },
  { id: "A5", text: "Backward-compat: subclass-level format override must still win", required: true,  matched: false },
  { id: "A6", text: "Update get_format() helper to short-circuit when meta_formats present", required: false, matched: false },
];

function PagePlanning() {
  const matched = ATOMS.filter(a => a.matched).length;
  const required = ATOMS.filter(a => a.required).length;
  const pct = Math.round(matched/ATOMS.length*100);
  return (
    <main className="main">
      <Topbar crumbs={["benchmark","experiments","exp_3a91f","runs","r_z3k","plan-score"]} />
      <PageHeader
        title="Plan score · r_z3k"
        sub="atom-level grading vs. human gold plan · django__django-14238"
        right={<>
          <button className="tb-btn">Edit gold plan</button>
          <button className="tb-btn">↧ Export YAML</button>
        </>}
      />
      <div style={{padding:"16px 24px", display:"grid", gridTemplateColumns:"1fr 320px", gap: 12}}>

        {/* main: side-by-side plans */}
        <div style={{display:"flex", flexDirection:"column", gap: 12}}>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{display:"flex", alignItems:"center", gap: 12}}>
              <div style={{position:"relative", width: 64, height: 64}}>
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="26" stroke="var(--bg-3)" strokeWidth="6" fill="none"/>
                  <circle cx="32" cy="32" r="26" stroke="var(--accent)" strokeWidth="6" fill="none"
                    strokeDasharray={`${2*Math.PI*26 * pct/100} 999`} strokeDashoffset="0"
                    transform="rotate(-90 32 32)" strokeLinecap="round"/>
                </svg>
                <div style={{position:"absolute", inset:0, display:"grid", placeItems:"center", fontFamily:"var(--mono)", fontSize:14, fontWeight:500}}>{pct}%</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize: 14, fontWeight: 500}}>4 of 6 atoms matched</div>
                <div className="mono dim" style={{fontSize:11.5, marginTop: 2}}>{matched}/{required} required · {ATOMS.filter(a=>!a.required && a.matched).length}/{ATOMS.filter(a=>!a.required).length} optional</div>
                <div style={{display:"flex", gap: 6, marginTop: 8}}>
                  {ATOMS.map(a => (
                    <span key={a.id} title={a.text} style={{
                      width: 28, height: 6, borderRadius: 2,
                      background: a.matched ? "var(--ok)" : a.required ? "var(--err)" : "var(--bg-3)",
                      opacity: a.required ? 1 : 0.5,
                    }}/>
                  ))}
                </div>
              </div>
              <div className="metric" style={{padding:0, textAlign:"right"}}>
                <div className="lab">E2E OUTCOME</div>
                <div className="val" style={{color:"var(--ok)"}}>RESOLVED</div>
                <div className="sub">despite 1 missed atom</div>
              </div>
            </div>
          </div>

          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12}}>
            <div className="card" style={{padding:0, overflow:"hidden"}}>
              <div style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", fontSize:12, fontWeight:500, display:"flex", justifyContent:"space-between"}}>
                <span>Gold plan</span>
                <span className="mono dim2" style={{fontSize:10.5}}>v3 · curator: a.k.</span>
              </div>
              {ATOMS.map(a => (
                <div key={a.id} style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", display:"flex", gap: 10}}>
                  <span className="mono" style={{fontSize:10, color: a.required ? "var(--accent)" : "var(--fg-3)", width: 22}}>{a.id}</span>
                  <span style={{fontSize:12, color:"var(--fg-1)", flex:1}}>{a.text}</span>
                  <span className="mono dim2" style={{fontSize:10}}>{a.required ? "req" : "opt"}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{padding:0, overflow:"hidden"}}>
              <div style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", fontSize:12, fontWeight:500, display:"flex", justifyContent:"space-between"}}>
                <span>Model plan · claude-sonnet-4.5</span>
                <span className="mono dim2" style={{fontSize:10.5}}>extracted at 00:24</span>
              </div>
              {ATOMS.map(a => (
                <div key={a.id} style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", display:"flex", gap: 10, alignItems:"center"}}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, fontSize: 9, fontFamily: "var(--mono)", fontWeight: 700,
                    display:"grid", placeItems:"center", flexShrink: 0,
                    background: a.matched ? "var(--ok)" : "transparent",
                    border: "1px solid " + (a.matched ? "var(--ok)" : a.required ? "var(--err)" : "var(--line-3)"),
                    color: a.matched ? "#0a1a0a" : a.required ? "var(--err)" : "var(--fg-3)",
                  }}>{a.matched ? "✓" : a.required ? "✕" : "—"}</span>
                  <span style={{fontSize: 12, color: a.matched ? "var(--fg-1)" : "var(--fg-3)", flex: 1, textDecoration: a.matched ? "none" : "line-through"}}>{a.text}</span>
                  {a.where && <span className="mono dim2" style={{fontSize:10}}>{a.where}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{display:"flex", alignItems:"center", gap: 8, marginBottom: 10}}>
              <span style={{fontSize:12.5, fontWeight:500}}>Atom-level performance across leaderboard</span>
              <span className="mono dim2" style={{fontSize:11}}>· this task · 12 models</span>
            </div>
            <div style={{display:"grid", gridTemplateColumns:"180px repeat(6, 1fr) 60px", gap: 4, fontSize: 11}}>
              <div className="mono dim" style={{fontSize:10}}>MODEL</div>
              {ATOMS.map(a => <div key={a.id} className="mono" style={{fontSize:10, color:"var(--fg-3)", textAlign:"center"}}>{a.id}</div>)}
              <div className="mono dim" style={{fontSize:10, textAlign:"right"}}>SCORE</div>
              {[
                ["claude-opus-4.1",   [1,1,1,1,1,1]],
                ["claude-sonnet-4.5", [1,1,1,1,0,0]],
                ["gpt-5",             [1,1,1,1,1,0]],
                ["o4",                [1,1,1,1,0,1]],
                ["gemini-2.5-pro",    [1,1,1,0,0,0]],
                ["grok-4",            [1,1,0,1,0,0]],
                ["claude-haiku-4.5",  [1,1,1,0,0,0]],
                ["qwen3-coder-480b",  [1,1,0,0,0,0]],
                ["gpt-5-mini",        [1,0,1,0,0,0]],
                ["deepseek-v3.2",     [1,1,0,0,0,0]],
                ["gemini-2.5-flash",  [1,0,0,0,0,0]],
                ["llama-4-maverick",  [0,1,0,0,0,0]],
              ].map(([m, hits]) => {
                const score = Math.round(hits.reduce((a,b)=>a+b,0)/6*100);
                return (
                  <React.Fragment key={m}>
                    <div style={{fontSize:11.5, padding:"3px 0"}}>{m}</div>
                    {hits.map((h,i) => (
                      <div key={i} style={{display:"grid", placeItems:"center"}}>
                        <div style={{width:14, height:14, borderRadius:2,
                          background: h ? "var(--ok)" : "var(--bg-3)",
                          opacity: h ? 0.85 : 1}}/>
                      </div>
                    ))}
                    <div className="mono" style={{fontSize:11, textAlign:"right"}}>{score}%</div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{display:"flex", flexDirection:"column", gap: 12}}>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Why this matters</div>
            <div style={{fontSize:12, lineHeight:1.6, color:"var(--fg-1)"}}>
              The model resolved the test, but missed atom <span className="mono" style={{color:"var(--accent)"}}>A5</span> (subclass override fallback). Patches that pass tests but miss required atoms tend to regress on adjacent tasks.
            </div>
          </div>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Atom A5 — missed by</div>
            {[
              ["claude-sonnet-4.5", true],
              ["gemini-2.5-pro", true],
              ["claude-haiku-4.5", true],
              ["qwen3-coder-480b", true],
              ["deepseek-v3.2", true],
              ["gemini-2.5-flash", true],
              ["llama-4-maverick", true],
            ].map(([m,_]) => (
              <div key={m} style={{display:"flex", justifyContent:"space-between", padding:"4px 0", fontSize: 11.5}}>
                <span>{m}</span>
                <span className="mono dim2" style={{fontSize:10.5}}>missed</span>
              </div>
            ))}
          </div>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Judge model</div>
            <div style={{display:"flex", flexDirection:"column", gap: 4, fontSize: 12}}>
              <div style={{display:"flex", justifyContent:"space-between"}}><span className="dim">Model</span><span className="mono">claude-opus-4.1</span></div>
              <div style={{display:"flex", justifyContent:"space-between"}}><span className="dim">Rubric</span><span className="mono">atom-v2.1</span></div>
              <div style={{display:"flex", justifyContent:"space-between"}}><span className="dim">Inter-rater κ</span><span className="mono">0.84</span></div>
              <div style={{display:"flex", justifyContent:"space-between"}}><span className="dim">Cost / judge</span><span className="mono">$0.04</span></div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

window.PagePlanning = PagePlanning;
