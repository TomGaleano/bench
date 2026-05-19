/* planning-v2.jsx — atom orbit graph */

const ATOMS2 = [
  { id: "A1", text: "Locate DateTimeField.bind() in django/forms/fields.py", required: true,  matched: true },
  { id: "A2", text: "Identify root form's _meta.formats as source of truth", required: true,  matched: true },
  { id: "A3", text: "Thread parent.formats through bind() with fallback", required: true,  matched: true },
  { id: "A4", text: "Update BoundField helper to expose resolved format", required: true,  matched: true },
  { id: "A5", text: "Backward-compat: subclass-level format override wins", required: true,  matched: false },
  { id: "A6", text: "Update get_format() to short-circuit when meta present", required: false, matched: false },
];

function PagePlanning2() {
  const matched = ATOMS2.filter(a => a.matched).length;
  const pct = Math.round(matched/ATOMS2.length*100);
  const cx = 50, cy = 50, r = 36; // percent

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","experiments","exp_3a91f","runs","r_z3k","plan grading"]}/>
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow"><span>plan grading · r_z3k · django__django-14238</span></div>
            <h1>Four of six <em>atoms</em>, but a perfect&nbsp;test suite.</h1>
            <p className="lede">The model passed every test, then missed the subclass-override fallback. Patches that resolve tests but skip required atoms tend to regress on adjacent tasks.</p>
          </div>
          <div className="meta">
            <div><b>67%</b> plan score</div>
            <div className="tag2 ok"><span className="pip"/>RESOLVED</div>
            <button className="btn2 sm" style={{marginTop:6}}>Edit gold plan</button>
          </div>
        </div>

        {/* atom orbit */}
        <div className="atom-orbit rise d1">
          <div className="atom-center">
            <div>
              <div className="pct">{pct}<span style={{fontSize:18}}>%</span></div>
              <div className="lab">{matched}/{ATOMS2.length} atoms</div>
            </div>
          </div>
          {/* connectors */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            {ATOMS2.map((a, i) => {
              const angle = (i / ATOMS2.length) * Math.PI * 2 - Math.PI/2;
              const x = cx + Math.cos(angle) * r;
              const y = cy + Math.sin(angle) * r;
              return (
                <line key={a.id} x1={cx} y1={cy} x2={x} y2={y}
                  stroke={a.matched ? "var(--ok)" : a.required ? "var(--err)" : "var(--rule-3)"}
                  strokeWidth="0.3" strokeDasharray={a.matched ? "" : "0.6,0.6"}
                  vectorEffect="non-scaling-stroke" opacity="0.6"/>
              );
            })}
          </svg>
          {ATOMS2.map((a, i) => {
            const angle = (i / ATOMS2.length) * Math.PI * 2 - Math.PI/2;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            return (
              <div key={a.id} className={"atom-node " + (a.matched ? "matched" : "missed " + (a.required ? "required" : "optional"))}
                style={{left:`${x}%`, top:`${y}%`, animationDelay: (i*80)+"ms"}}>
                <div className="pill">{a.id}</div>
                <div className="lab">{a.text}</div>
              </div>
            );
          })}
        </div>

        {/* gold vs model side-by-side */}
        <div className="grid g2 gap-16" style={{marginTop: 24}}>
          <div className="card2 rise d2">
            <div className="card2-hd"><span className="card2-ti">Gold plan</span><span className="mono dim" style={{fontSize:11}}>v3 · curator a.k.</span></div>
            {ATOMS2.map(a => (
              <div key={a.id} className="row gap-10" style={{padding:"12px 16px", borderBottom:"1px solid var(--rule)"}}>
                <span className="mono" style={{width: 24, color: a.required ? "var(--accent)" : "var(--ink-4)"}}>{a.id}</span>
                <span style={{fontSize: 13}}>{a.text}</span>
                <span className="mono dim right" style={{fontSize: 10.5}}>{a.required ? "REQ" : "OPT"}</span>
              </div>
            ))}
          </div>
          <div className="card2 rise d3">
            <div className="card2-hd"><span className="card2-ti">Model plan · sonnet-4.5</span><span className="mono dim" style={{fontSize:11}}>extracted at 00:24</span></div>
            {ATOMS2.map(a => (
              <div key={a.id} className="row gap-10" style={{padding:"12px 16px", borderBottom:"1px solid var(--rule)"}}>
                <div style={{
                  width: 18, height: 18, borderRadius: 5,
                  background: a.matched ? "var(--ok)" : "transparent",
                  border: "1.5px solid " + (a.matched ? "var(--ok)" : a.required ? "var(--err)" : "var(--rule-3)"),
                  display:"grid", placeItems:"center", color:"white", fontSize:10, fontFamily:"var(--mono)",
                }}>{a.matched ? "✓" : a.required ? "✕" : "—"}</div>
                <span style={{fontSize: 13, color: a.matched ? "var(--ink)" : "var(--ink-4)", textDecoration: a.matched ? "none" : "line-through"}}>{a.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* atom heatmap */}
        <div className="section-h"><span className="num">02</span> Atom-level <em>across</em> the leaderboard</div>
        <div className="card2 rise" style={{padding: 0, overflow:"hidden"}}>
          <div style={{display:"grid", gridTemplateColumns:"180px repeat(6, 1fr) 60px", padding:"10px 16px", borderBottom:"1px solid var(--rule)", background:"var(--paper-2)", fontFamily:"var(--mono)", fontSize: 10, color:"var(--ink-4)", textTransform:"uppercase", letterSpacing:"0.07em"}}>
            <div>Model</div>
            {ATOMS2.map(a => <div key={a.id} style={{textAlign:"center"}}>{a.id}</div>)}
            <div style={{textAlign:"right"}}>Score</div>
          </div>
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
              <div key={m} style={{display:"grid", gridTemplateColumns:"180px repeat(6, 1fr) 60px", padding:"10px 16px", borderBottom:"1px solid var(--rule)", alignItems:"center"}}>
                <div style={{fontSize: 13}}>{m}</div>
                {hits.map((h,i) => (
                  <div key={i} className="center">
                    <div style={{width: 18, height: 18, borderRadius: 4,
                      background: h ? "var(--ok)" : "var(--paper-3)",
                      opacity: h ? 0.9 : 1, border: h ? "none" : "1px solid var(--rule-2)"}}/>
                  </div>
                ))}
                <div className="mono right" style={{fontSize: 12, fontWeight: 500}}>{score}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

window.PagePlanning2 = PagePlanning2;
