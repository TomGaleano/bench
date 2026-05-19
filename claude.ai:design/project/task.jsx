/* task.jsx — Page 6: Task detail */

function PageTask() {
  const t = TASKS[1]; // django__django-15814
  return (
    <main className="main">
      <Topbar crumbs={["benchmark","tasks","django__django-15814"]} />
      <PageHeader
        title={t.id}
        sub={`${t.repo} · L diff · 7 files · 142 lines · 5 fail-to-pass / 412 pass-to-pass`}
        right={<>
          <span className="chip" style={{fontFamily:"var(--mono)"}}>swe-bench-verified · v25.04</span>
          <button className="tb-btn">View on GitHub ↗</button>
          <button className="tb-btn primary">Try a model →</button>
        </>}
      />
      <div style={{padding:"16px 24px", display:"grid", gridTemplateColumns:"1fr 360px", gap: 12}}>

        <div style={{display:"flex", flexDirection:"column", gap: 12}}>
          <div className="card" style={{padding:"14px 18px"}}>
            <div style={{display:"flex", alignItems:"center", gap: 10, marginBottom: 4}}>
              <span className="mono dim2" style={{fontSize:11}}>issue #15814</span>
              <span className="dim2">·</span>
              <span className="mono dim2" style={{fontSize:11}}>opened 2022-06-29</span>
              <span className="dim2">·</span>
              <span className="chip" style={{fontFamily:"var(--mono)"}}>orm</span>
              <span className="chip" style={{fontFamily:"var(--mono)"}}>queryset</span>
            </div>
            <div style={{fontSize: 16, fontWeight: 500, marginTop: 4}}>QuerySet.only() with select_related() crashes when the related field is a reverse OneToOne</div>
            <div style={{marginTop: 10, fontSize: 12.5, lineHeight: 1.7, color: "var(--fg-1)", maxWidth: 720}}>
              Calling <span className="mono" style={{color:"var(--accent)"}}>only()</span> with a deferred field on a reverse <span className="mono" style={{color:"var(--accent)"}}>OneToOneField</span> raises <span className="mono">FieldError: Invalid field name(s)</span>. The expected behavior — and the behavior with forward relations — is to silently load the field via the joined select. Reproduction included; failing test attached at <span className="mono">tests/defer/tests.py::DeferRelationsTests::test_only_with_reverse_o2o</span>.
            </div>
          </div>

          <div className="card" style={{padding:0, overflow:"hidden"}}>
            <div style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
              <div style={{fontSize:12, fontWeight:500}}>Failing tests</div>
              <span className="mono dim2" style={{fontSize:10.5}}>5 fail · 412 pass-to-pass</span>
            </div>
            {[
              "tests/defer/tests.py::DeferRelationsTests::test_only_with_reverse_o2o",
              "tests/defer/tests.py::DeferRelationsTests::test_only_with_chained_reverse_o2o",
              "tests/defer/tests.py::DeferRelationsTests::test_only_with_reverse_o2o_and_select_related",
              "tests/queries/test_qs_combinators.py::QuerySetSetOperationTests::test_only_with_reverse_o2o",
              "tests/model_inheritance/test_abstract_inheritance.py::AbstractInheritanceTests::test_only_with_reverse_o2o",
            ].map((n, i) => (
              <div key={n} style={{padding:"8px 14px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center", gap: 10}}>
                <span style={{width:6, height:6, borderRadius:"50%", background:"var(--err)"}}/>
                <span className="mono" style={{fontSize:11, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{n}</span>
                <span className="mono dim2" style={{fontSize:10.5}}>0.0{4+i}s</span>
              </div>
            ))}
          </div>

          <div className="card" style={{padding:0, overflow:"hidden"}}>
            <div style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center"}}>
              <div style={{fontSize:12, fontWeight:500}}>Gold patch</div>
              <span className="mono dim2" style={{fontSize:10.5, marginLeft: 10}}>3 files · +47 −12</span>
              <span style={{flex:1}}/>
              <button className="tb-btn">Hide</button>
            </div>
            <div style={{padding: "8px 0", maxHeight: 280, overflow:"auto"}}>
              <div className="diff-line hunk"><span className="ln"/>@@ django/db/models/sql/query.py @@</div>
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
              ].map(([k, ln, src], i) => (
                <div key={i} className={"diff-line " + k}>
                  <span className="ln">{ln}</span>
                  <span>{src}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{padding:"14px 16px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:10}}>Model performance on this task</div>
            <table className="tbl" style={{margin:0}}>
              <thead><tr>
                <th>Model</th><th>Harness</th><th>Outcome</th>
                <th className="r">Plan</th><th className="r">Cost</th><th className="r">Tokens</th><th className="r">Wall</th>
              </tr></thead>
              <tbody>
                {[
                  ["claude-opus-4.1", "pi-plan+impl·0.9","resolved", 100, 2.84, 38120, 312],
                  ["claude-sonnet-4.5","pi-react/1.4·50t","resolved", 83, 1.12, 28411, 218],
                  ["gpt-5",             "pi-react/1.4·50t","resolved", 83, 1.74, 32044, 244],
                  ["o4",                "pi-react/1.4·50t","resolved", 100, 3.18, 41822, 387],
                  ["gemini-2.5-pro",    "pi-react/1.4·50t","resolved", 67, 0.51, 24710, 198],
                  ["grok-4",            "pi-react/1.4·50t","failed", 50, 0.91, 27214, 264],
                  ["claude-haiku-4.5",  "pi-react/1.4·30t","failed", 50, 0.18, 14821, 144],
                  ["qwen3-coder-480b",  "pi-react/1.4·50t","failed", 33, 0.09, 21118, 168],
                  ["gpt-5-mini",        "pi-react/1.4·30t","timeout",33, 0.14, 19844, 600],
                  ["deepseek-v3.2",     "pi-react/1.4·50t","failed", 17, 0.06, 23104, 211],
                  ["gemini-2.5-flash",  "pi-react/1.4·30t","failed", 17, 0.04, 16802, 117],
                  ["llama-4-maverick",  "pi-react/1.4·50t","failed",  0, 0.13, 24818, 199],
                ].map(([m,h,o,p,c,tk,w]) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td className="num dim">{h}</td>
                    <td><span className={"chip s-" + o}>{o}</span></td>
                    <td className="r num">{p}%</td>
                    <td className="r num">${c.toFixed(2)}</td>
                    <td className="r num">{(tk/1000).toFixed(1)}k</td>
                    <td className="r num">{Math.floor(w/60)}:{String(w%60).padStart(2,"0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{display:"flex", flexDirection:"column", gap: 12}}>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Difficulty</div>
            <div style={{display:"flex", gap: 4, marginBottom: 10}}>
              {["S","M","L","XL"].map(d => (
                <span key={d} style={{
                  flex:1, padding:"4px 0", textAlign:"center", fontSize: 11, fontFamily:"var(--mono)",
                  background: d === "L" ? "var(--accent)" : "var(--bg-2)",
                  color: d === "L" ? "#1a1100" : "var(--fg-3)",
                  border:"1px solid " + (d === "L" ? "var(--accent-line)" : "var(--line-2)"),
                  borderRadius: 4
                }}>{d}</span>
              ))}
            </div>
            {[
              ["Files touched", "7"],
              ["Lines changed", "142"],
              ["Cyclomatic Δ", "+8"],
              ["Resolved by", "5 / 12 models"],
              ["Median wall", "218s"],
              ["Median cost", "$0.91"],
            ].map(([k,v]) => (
              <div key={k} style={{display:"flex", justifyContent:"space-between", padding:"4px 0", fontSize:12}}>
                <span className="dim">{k}</span><span className="mono">{v}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Hint atoms (gold plan)</div>
            <ol style={{margin: 0, padding: "0 0 0 18px", fontSize: 12, color:"var(--fg-1)", lineHeight: 1.6}}>
              <li>Trace add_immediate_loading() in sql/query.py</li>
              <li>Recognize names_to_path expects materialized paths</li>
              <li>Resolve reverse-O2O accessor before the difference()</li>
              <li>Update Query.deferred_to_data signature to accept paths</li>
              <li>Add regression test under tests/defer/</li>
              <li>Preserve perf for large defer-sets (no extra DB query)</li>
            </ol>
          </div>

          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Trends · last 6 weeks</div>
            <svg viewBox="0 0 220 80" width="100%" height="80">
              <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5"
                points="0,72 36,68 72,52 108,48 144,40 180,32 220,28"/>
              <polyline fill="none" stroke="var(--fg-3)" strokeWidth="1" strokeDasharray="2,2"
                points="0,76 36,74 72,68 108,62 144,58 180,54 220,52"/>
            </svg>
            <div style={{display:"flex", justifyContent:"space-between", fontSize:10.5, color:"var(--fg-3)", fontFamily:"var(--mono)"}}>
              <span>2.4× resolution rate</span>
              <span style={{color:"var(--accent)"}}>frontier ↑</span>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

window.PageTask = PageTask;
