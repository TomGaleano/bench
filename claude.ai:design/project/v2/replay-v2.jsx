/* replay-v2.jsx — cinematic horizontal timeline */

const RP_EVENTS = [
  { t: 0,   m: "00:00", k: "system",  ti: "Sandbox spun up",       body: "ubuntu-22.04 · python 3.11 · 4 vCPU / 8 GiB" },
  { t: 8,   m: "00:08", k: "stage",   ti: "Plan stage handoff",    body: "claude-sonnet-4.5 receives task spec + repo overview" },
  { t: 14,  m: "00:14", k: "tool",    ti: "fs.read",               body: "django/forms/fields.py:280-360", ok: true },
  { t: 16,  m: "00:16", k: "tool",    ti: "grep",                  body: "'DEFAULT_FORMAT' under django/forms — 4 hits", ok: true },
  { t: 21,  m: "00:21", k: "thought", ti: "Plan emitted",          body: "Thread parent.formats through DateTimeField.bind. Preserve fallback to DEFAULT_FORMAT. Update BoundField helper." },
  { t: 24,  m: "00:24", k: "judge",   ti: "Plan judged",           body: "4 of 6 atoms matched gold. Missing: subclass-override fallback, get_format helper.", score: 67 },
  { t: 31,  m: "00:31", k: "tool",    ti: "str.replace",           body: "django/forms/fields.py @ 312 (12 → 17 lines)", ok: true },
  { t: 39,  m: "00:39", k: "tool",    ti: "str.replace",           body: "django/forms/boundfield.py @ 88 (3 → 6 lines)", ok: true },
  { t: 48,  m: "00:48", k: "test",    ti: "pytest run",            body: "pytest -xvs tests/forms/test_datetime.py", ok: false, out: "FAILED test_subclass_override" },
  { t: 54,  m: "00:54", k: "thought", ti: "Recovery",              body: "Subclass override case wasn't planned — defer to field.format if explicitly set." },
  { t: 59,  m: "00:59", k: "tool",    ti: "str.replace",           body: "django/forms/fields.py @ 318 (small fix)", ok: true },
  { t: 64,  m: "01:04", k: "test",    ti: "pytest re-run",         body: "7 passed in 0.42s", ok: true },
  { t: 66,  m: "01:06", k: "test",    ti: "regression suite",      body: "412 passed in 11.83s", ok: true },
  { t: 69,  m: "01:09", k: "done",    ti: "Patch accepted",        body: "47 lines · 2 files · all FAIL_TO_PASS now passing" },
];

const PATCH = `--- a/django/forms/fields.py
+++ b/django/forms/fields.py
@@ -310,8 +310,13 @@ class DateTimeField(BaseTemporalField):
     input_formats = formats.get_format_lazy('DATETIME_INPUT_FORMATS')

-    def bind(self, name, form, *args, **kw):
-        super().bind(name, form, *args, **kw)
-        self._format = self.input_formats[0]
+    def bind(self, name, form, *args, **kw):
+        super().bind(name, form, *args, **kw)
+        meta_formats = getattr(getattr(form, '_meta', None), 'formats', None)
+        if meta_formats and 'datetime' in meta_formats:
+            self._format = meta_formats['datetime']
+        else:
+            self._format = self.input_formats[0]
`;

function PageReplay2() {
  const [pos, setPos] = React.useState(RP_EVENTS.length - 3);
  const cur = RP_EVENTS[pos];
  const total = RP_EVENTS[RP_EVENTS.length-1].t;

  const colorFor = (k) => k === "thought" ? "var(--ink)" : k === "judge" ? "var(--accent)"
    : k === "tool" ? "var(--cool)" : k === "test" ? "var(--plum)" : k === "done" ? "var(--ok)"
    : k === "stage" ? "var(--warn)" : "var(--ink-4)";

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","experiments","exp_3a91f","runs","r_z3k"]}/>
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow"><span className="tag2 ok"><span className="pip"/>resolved</span><span className="faint">·</span><span>r_z3k</span><span className="faint">·</span><span>claude-sonnet-4.5</span></div>
            <h1>One <em>plan</em>, two recoveries, <em>seven</em> tests passing.</h1>
            <p className="lede">A complete trace of how <span className="mono">claude-sonnet-4.5</span> resolved <span className="mono">django__django-14238</span> in 1 minute 9 seconds — 11 turns, 24,118 tokens, $0.74.</p>
          </div>
          <div className="meta">
            <div className="row gap-6"><button className="btn2 sm">← Prev</button><button className="btn2 sm">Next →</button></div>
            <div><b>$0.74</b> · 24,118 tok · 11 turns</div>
            <div><b>67%</b> plan score · <b>RESOLVED</b></div>
          </div>
        </div>

        {/* horizontal cinematic timeline */}
        <div className="card2 rise d1" style={{padding:"22px 26px"}}>
          <div className="row gap-12" style={{marginBottom: 14}}>
            <button className="btn2 sm">⏮</button>
            <button className="btn2 primary sm" style={{padding:"6px 14px"}}>▶ Play</button>
            <button className="btn2 sm">⏭</button>
            <span className="mono dim" style={{fontSize:11.5}}>{cur.m} / 01:09</span>
            <span className="right mono dim" style={{fontSize:11}}>1.0×</span>
          </div>
          <div style={{position:"relative", padding: "32px 0 24px"}}>
            <div style={{position:"absolute", left: 0, right: 0, top: "50%", height: 2, background:"var(--rule-2)", borderRadius: 1}}/>
            <div style={{position:"absolute", left: 0, top: "50%", height: 2, background: "var(--ink)",
              width: `${(cur.t/total)*100}%`, borderRadius: 1, transition: "width 220ms ease"}}/>
            {/* events */}
            {RP_EVENTS.map((e, i) => {
              const x = (e.t / total) * 100;
              const isCur = i === pos;
              const passed = i <= pos;
              return (
                <div key={i} onClick={() => setPos(i)} style={{
                  position:"absolute", left: `${x}%`, top: "50%", transform:"translate(-50%,-50%)",
                  cursor: "pointer", zIndex: isCur ? 4 : 1,
                }}>
                  <div style={{
                    width: isCur ? 18 : 11, height: isCur ? 18 : 11, borderRadius: "50%",
                    background: passed ? colorFor(e.k) : "var(--paper)",
                    border: `2px solid ${colorFor(e.k)}`,
                    boxShadow: isCur ? `0 0 0 6px ${colorFor(e.k)}25` : "var(--shadow-1)",
                    transition: "all 200ms ease",
                  }}/>
                  <div style={{
                    position:"absolute", left: "50%", top: i % 2 === 0 ? "-44px" : "20px",
                    transform: "translateX(-50%)", whiteSpace: "nowrap",
                    fontFamily:"var(--mono)", fontSize: 10, color: passed ? "var(--ink-2)" : "var(--ink-5)",
                    textAlign:"center", opacity: isCur ? 1 : 0.7,
                  }}>
                    <div style={{fontWeight: isCur ? 600 : 400}}>{e.ti}</div>
                    <div style={{color:"var(--ink-4)"}}>{e.m}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row gap-12" style={{justifyContent:"space-between", fontFamily:"var(--mono)", fontSize:10.5, color:"var(--ink-4)", marginTop: 8}}>
            <span>plan</span><span>judge</span><span>implement</span><span>test</span><span>recover</span><span>done</span>
          </div>
        </div>

        {/* focus + side panels */}
        <div className="grid gap-16" style={{gridTemplateColumns:"1fr 320px", marginTop: 16}}>
          <div className="col gap-16">
            <div className="card2 rise d2" style={{padding: 0, overflow:"hidden"}}>
              <div className="card2-hd">
                <div className="row gap-8">
                  <span className="tag2 dot" style={{color: colorFor(cur.k), borderColor: colorFor(cur.k)}}><span className="pip"/>{cur.k}</span>
                  <span style={{fontSize:14, fontWeight:500}}>{cur.ti}</span>
                </div>
                <span className="mono dim" style={{fontSize:11}}>{cur.m}</span>
              </div>
              <div style={{padding:"16px 20px"}}>
                <div className="serif" style={{fontSize: 18, lineHeight: 1.5, color:"var(--ink-2)"}}>{cur.body}</div>
                {cur.score != null && (
                  <div style={{marginTop: 12}}>
                    <div className="mono dimer" style={{fontSize:10, textTransform:"uppercase", letterSpacing:"0.07em"}}>Atom score</div>
                    <div className="num-md" style={{color:"var(--accent)", marginTop:4}}>{cur.score}<span style={{fontSize:18}}>%</span></div>
                  </div>
                )}
                {cur.out && <pre className="l" style={{marginTop:12}}>{cur.out}</pre>}
              </div>
            </div>

            <div className="card2 rise d3" style={{padding: 0, overflow:"hidden"}}>
              <div className="card2-hd">
                <span className="card2-ti">Final patch</span>
                <span className="mono dim" style={{fontSize:11}}>2 files · +18 −6</span>
              </div>
              <pre className="l" style={{margin:0, border:"none", borderRadius: 0, background: "var(--paper)"}}>{PATCH}</pre>
            </div>
          </div>

          <div className="col gap-12">
            <div className="card2" style={{padding:"16px 18px"}}>
              <div className="card2-ti">Outcome</div>
              <div className="grid g2 gap-12" style={{marginTop: 12}}>
                <div><div className="mono dimer" style={{fontSize:10}}>E2E</div><div className="num-md" style={{color:"var(--ok)"}}>RESOLVED</div></div>
                <div><div className="mono dimer" style={{fontSize:10}}>PLAN</div><div className="num-md">67%</div></div>
                <div><div className="mono dimer" style={{fontSize:10}}>COST</div><div className="num-md">$0.74</div></div>
                <div><div className="mono dimer" style={{fontSize:10}}>TURNS</div><div className="num-md">11<span className="dim" style={{fontSize:14}}>/50</span></div></div>
              </div>
            </div>
            <div className="card2" style={{padding:"16px 18px"}}>
              <div className="card2-ti">Tool usage</div>
              <div className="col gap-6" style={{marginTop: 10}}>
                {[["fs.read",4,"var(--cool)"],["grep",2,"var(--cool)"],["str.replace",3,"var(--plum)"],["shell.exec",2,"var(--accent)"]].map(([n,c,col]) => (
                  <div key={n} className="row gap-8">
                    <span className="mono" style={{fontSize:11, width: 84}}>{n}</span>
                    <div style={{flex:1, height:6, background:"var(--paper-3)", borderRadius:3}}>
                      <div style={{width: `${c*10}%`, height:"100%", background:col, borderRadius:3, animation:"growBar 800ms cubic-bezier(0.2,0.8,0.2,1)", transformOrigin:"left"}}/>
                    </div>
                    <span className="mono dim" style={{fontSize:11, width: 18, textAlign:"right"}}>{c}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card2" style={{padding:"16px 18px"}}>
              <div className="card2-ti">Same task, other models</div>
              <div className="col gap-4" style={{marginTop: 10, fontSize: 12}}>
                {[["claude-opus-4.1","$2.18","ok",true],["gpt-5","$1.04","ok",false],["gemini-2.5-pro","$0.31","err",false],["claude-haiku-4.5","$0.18","warn",false],["deepseek-v3.2","$0.06","err",false]].map(([m,c,k,cur]) => (
                  <div key={m} className="row gap-8" style={{padding:"4px 0", borderBottom:"1px solid var(--rule)"}}>
                    <span style={{fontSize: 12, color: cur?"var(--ink)":"var(--ink-2)"}}>{m}{cur && <span className="mono dim" style={{marginLeft:6, fontSize:10}}>(this)</span>}</span>
                    <span className="mono right" style={{fontSize:11}}>{c}</span>
                    <span className={"tag2 " + k} style={{minWidth:62, justifyContent:"center"}}>{k==="ok"?"resolved":k==="err"?"failed":"timeout"}</span>
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

window.PageReplay2 = PageReplay2;
