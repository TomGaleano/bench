/* task-v2.jsx — task detail with cost/score scatter */

function PageTask2() {
  const t = TASKS[1]; // django__django-15814
  const rows = [
    ["claude-opus-4.1",   "resolved", 100, 2.84, 38120, 312],
    ["claude-sonnet-4.5", "resolved",  83, 1.12, 28411, 218],
    ["gpt-5",             "resolved",  83, 1.74, 32044, 244],
    ["o4",                "resolved", 100, 3.18, 41822, 387],
    ["gemini-2.5-pro",    "resolved",  67, 0.51, 24710, 198],
    ["grok-4",            "failed",    50, 0.91, 27214, 264],
    ["claude-haiku-4.5",  "failed",    50, 0.18, 14821, 144],
    ["qwen3-coder-480b",  "failed",    33, 0.09, 21118, 168],
    ["gpt-5-mini",        "timeout",   33, 0.14, 19844, 600],
    ["deepseek-v3.2",     "failed",    17, 0.06, 23104, 211],
    ["gemini-2.5-flash",  "failed",    17, 0.04, 16802, 117],
    ["llama-4-maverick",  "failed",     0, 0.13, 24818, 199],
  ];

  // scatter: x = cost, y = plan score, color by outcome
  const w = 600, h = 240, pad = 36;
  const xs = rows.map(r => r[3]), ys = rows.map(r => r[2]);
  const xMax = Math.max(...xs)*1.1, yMax = 105, yMin = -5;
  const px = v => pad + (v/xMax)*(w-2*pad);
  const py = v => h-pad - ((v-yMin)/(yMax-yMin))*(h-2*pad);

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","tasks","django__django-15814"]}/>
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow">
              <span className="tag2">swe-bench-verified · v25.04</span><span className="faint">·</span>
              <span>django/django</span><span className="faint">·</span><span>L diff · 7 files · 142 lines</span>
            </div>
            <h1>{t.id}</h1>
            <p className="lede serif italic" style={{fontSize: 17, color:"var(--ink-2)"}}>QuerySet.only() with select_related() crashes when the related field is a reverse OneToOne.</p>
            <p className="lede" style={{marginTop: 6}}>Calling <span className="mono">only()</span> with a deferred field on a reverse <span className="mono">OneToOneField</span> raises <span className="mono">FieldError</span>. Expected behavior — and forward-relation behavior — is to load the field via the joined select.</p>
          </div>
          <div className="meta">
            <div className="row gap-4"><span className="tag2">orm</span><span className="tag2">queryset</span></div>
            <div><b>5</b> fail-to-pass · <b>412</b> pass-to-pass</div>
            <div><b>5/12</b> models resolved</div>
            <button className="btn2 accent" style={{marginTop:6, padding:"8px 14px"}}>Try a model →</button>
          </div>
        </div>

        {/* cost vs plan-score scatter */}
        <div className="grid gap-16" style={{gridTemplateColumns:"1.5fr 1fr"}}>
          <div className="card2 rise d1" style={{padding: "18px 22px"}}>
            <div className="row" style={{marginBottom: 6}}>
              <span className="card2-ti">Cost vs plan score on this task</span>
              <span className="mono right dim" style={{fontSize:10.5}}>12 models · sized by tokens</span>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h+16} style={{overflow:"visible"}}>
              {/* gridlines */}
              {[0,25,50,75,100].map(p => (
                <line key={p} x1={pad} x2={w-pad} y1={py(p)} y2={py(p)} stroke="var(--rule)" strokeDasharray={p===0?"":"2,3"} />
              ))}
              {[0,1,2,3].map(v => (
                <line key={v} x1={px(v)} x2={px(v)} y1={pad} y2={h-pad} stroke="var(--rule)" strokeDasharray="2,3" opacity="0.5"/>
              ))}
              {/* axes labels */}
              {[0,25,50,75,100].map(p => (
                <text key={p} x={pad-8} y={py(p)+3} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-4)">{p}%</text>
              ))}
              {[0,1,2,3].map(v => (
                <text key={v} x={px(v)} y={h-pad+14} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-4)">${v.toFixed(2)}</text>
              ))}
              <text x={w-pad} y={h-pad+30} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-3)">cost ($) →</text>
              <text x={pad-8} y={pad-10} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-3)">plan score</text>
              {/* points */}
              {rows.map(([m,o,p,c,tk], i) => {
                const fill = o === "resolved" ? "var(--ok)" : o === "failed" ? "var(--err)" : "var(--warn)";
                const radius = 4 + Math.sqrt(tk/2000);
                return (
                  <g key={m} style={{animation: `popIn 600ms ${i*60}ms cubic-bezier(0.2,0.8,0.2,1) both`, transformOrigin:`${px(c)}px ${py(p)}px`}}>
                    <circle cx={px(c)} cy={py(p)} r={radius} fill={fill} fillOpacity="0.18" stroke={fill} strokeWidth="1.5"/>
                    <text x={px(c)+radius+6} y={py(p)+3} fontFamily="var(--mono)" fontSize="10" fill="var(--ink-2)">{m.split("-").slice(0,2).join("-")}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="col gap-12 rise d2">
            <div className="card2" style={{padding:"16px 18px"}}>
              <div className="card2-ti">Difficulty</div>
              <div className="row gap-4" style={{marginTop: 12}}>
                {["S","M","L","XL"].map(d => (
                  <div key={d} style={{
                    flex:1, padding:"10px 0", textAlign:"center", fontFamily:"var(--mono)", fontSize:13,
                    background: d==="L"?"var(--ink)":"var(--paper-2)",
                    color: d==="L"?"var(--paper)":"var(--ink-4)",
                    border: "1px solid "+(d==="L"?"var(--ink)":"var(--rule)"),
                    borderRadius: 6,
                  }}>{d}</div>
                ))}
              </div>
              <div className="grid g2 gap-10" style={{marginTop: 14}}>
                {[["FILES","7"],["LINES","142"],["MEDIAN WALL","218s"],["MEDIAN COST","$0.91"]].map(([k,v]) => (
                  <div key={k}><div className="mono dimer" style={{fontSize:10}}>{k}</div><div className="num-md">{v}</div></div>
                ))}
              </div>
            </div>
            <div className="card2" style={{padding:"16px 18px"}}>
              <div className="card2-ti">Trend · 6 weeks</div>
              <Sparkline data={[12,18,24,28,33,42]} color="var(--accent)" w={260} h={56} fill/>
              <div className="mono dim" style={{fontSize:11, marginTop: 4}}><span style={{color:"var(--accent)"}}>2.4×</span> resolution rate</div>
            </div>
          </div>
        </div>

        {/* gold patch */}
        <div className="section-h"><span className="num">02</span> Gold <em>patch</em></div>
        <div className="card2 rise" style={{padding: 0, overflow:"hidden"}}>
          <div className="card2-hd">
            <span className="card2-ti">3 files · +47 −12</span>
            <button className="btn2 sm">View raw</button>
          </div>
          <div className="diff2" style={{padding:"8px 0"}}>
            <div className="row hunk"><span className="ln"/>@@ django/db/models/sql/query.py @@</div>
            {[
              ["ctx", 1842, "    def add_immediate_loading(self, field_names):"],
              ["ctx", 1843, "        existing, defer = self.deferred_loading"],
              ["del", 1844, "        if defer:"],
              ["del", 1845, "            field_names = set(field_names).difference(existing)"],
              ["add", 1844, "        field_names = self.names_to_path(field_names, self.get_meta())[0]"],
              ["add", 1845, "        if defer:"],
              ["add", 1846, "            field_names = set(field_names).difference(existing)"],
              ["ctx", 1847, "        else:"],
              ["ctx", 1848, "            field_names = existing.union(field_names)"],
            ].map(([k,ln,src],i)=>(
              <div key={i} className={"row " + k}>
                <span className="ln">{ln}</span>
                <span>{src}</span>
              </div>
            ))}
          </div>
        </div>

        {/* per-model results */}
        <div className="section-h"><span className="num">03</span> All <em>twelve</em> models on this task</div>
        <div className="card2 rise" style={{padding: 0, overflow:"hidden"}}>
          <div style={{display:"grid", gridTemplateColumns:"1.6fr 1fr 90px 0.7fr 0.7fr 0.7fr 0.7fr", padding:"10px 18px", borderBottom:"1px solid var(--rule)", background:"var(--paper-2)", fontFamily:"var(--mono)", fontSize:10, color:"var(--ink-4)", textTransform:"uppercase", letterSpacing:"0.07em"}}>
            <div>Model</div><div>Harness</div><div>Outcome</div><div style={{textAlign:"right"}}>Plan</div><div style={{textAlign:"right"}}>Cost</div><div style={{textAlign:"right"}}>Tokens</div><div style={{textAlign:"right"}}>Wall</div>
          </div>
          {rows.map(([m,o,p,c,tk,w]) => (
            <div key={m} style={{display:"grid", gridTemplateColumns:"1.6fr 1fr 90px 0.7fr 0.7fr 0.7fr 0.7fr", padding:"12px 18px", borderBottom:"1px solid var(--rule)", alignItems:"center"}}>
              <div style={{fontSize:13.5}}>{m}</div>
              <div className="mono dim" style={{fontSize:11}}>pi-react/1.4·50t</div>
              <div><span className={"tag2 " + (o==="resolved"?"ok":o==="failed"?"err":"warn")}>{o}</span></div>
              <div className="mono right" style={{fontSize:12}}>{p}%</div>
              <div className="mono right" style={{fontSize:12}}>${c.toFixed(2)}</div>
              <div className="mono right" style={{fontSize:12}}>{(tk/1000).toFixed(1)}k</div>
              <div className="mono right" style={{fontSize:12}}>{Math.floor(w/60)}:{String(w%60).padStart(2,"0")}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

window.PageTask2 = PageTask2;
