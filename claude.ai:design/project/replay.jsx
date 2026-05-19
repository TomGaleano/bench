/* replay.jsx — Page 4: Run detail / replay timeline */

const REPLAY_EVENTS = [
  { t: "00:00", k: "system",  title: "Run started",          body: "Sandbox: ubuntu-22.04 · python 3.11 · 4 vCPU / 8 GiB", tag: "init" },
  { t: "00:02", k: "tool",    title: "git.clone",            body: "django/django @ 4f8a2c1 → /work", tag: "git", ok: true },
  { t: "00:08", k: "system",  title: "Plan-stage handoff",   body: "claude-sonnet-4.5 receives task spec + repo overview", tag: "stage" },
  { t: "00:11", k: "thought", title: "Reading the failure",  body: "The test expects DateTimeField to honor the format set on the parent form's _meta.formats. Right now bind() falls back to the field-local DEFAULT_FORMAT.", tag: "plan" },
  { t: "00:14", k: "tool",    title: "fs.read",              body: "django/forms/fields.py:280-360", tag: "read", ok: true },
  { t: "00:16", k: "tool",    title: "grep",                 body: "'DEFAULT_FORMAT' under django/forms — 4 hits", tag: "read", ok: true },
  { t: "00:21", k: "thought", title: "Plan",                 body: "1) thread parent.formats through DateTimeField.bind. 2) preserve fallback to DEFAULT_FORMAT. 3) update one helper in BoundField to expose the resolved format.", tag: "plan" },
  { t: "00:24", k: "judge",   title: "Plan judged",          body: "4/6 atoms matched gold plan. Missing: ‘update get_format helper’, ‘backward-compat for sub-class overrides’", tag: "judge", score: "67%" },
  { t: "00:31", k: "tool",    title: "str.replace",          body: "django/forms/fields.py @ 312 (12 → 17 lines)", tag: "write", ok: true },
  { t: "00:39", k: "tool",    title: "str.replace",          body: "django/forms/boundfield.py @ 88 (3 → 6 lines)", tag: "write", ok: true },
  { t: "00:48", k: "tool",    title: "shell.exec",           body: "pytest -xvs tests/forms/test_datetime.py", tag: "test", ok: false, out: "FAILED tests/forms/test_datetime.py::FormatResolution::test_subclass_override" },
  { t: "00:54", k: "thought", title: "Recovery",             body: "Subclass override case wasn’t in my plan — need to defer to field.format if explicitly set.", tag: "plan" },
  { t: "00:59", k: "tool",    title: "str.replace",          body: "django/forms/fields.py @ 318 (small fix)", tag: "write", ok: true },
  { t: "01:04", k: "tool",    title: "shell.exec",           body: "pytest -xvs tests/forms/test_datetime.py", tag: "test", ok: true, out: "7 passed in 0.42s" },
  { t: "01:06", k: "tool",    title: "shell.exec",           body: "pytest tests/forms/", tag: "test", ok: true, out: "412 passed in 11.83s" },
  { t: "01:09", k: "system",  title: "Patch accepted",       body: "47 lines · 2 files · all FAIL_TO_PASS now passing", tag: "done" },
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
+        # Prefer the format declared on the parent form's Meta if present,
+        # so a single form-level override propagates to all temporal fields.
+        meta_formats = getattr(getattr(form, '_meta', None), 'formats', None)
+        if meta_formats and 'datetime' in meta_formats:
+            self._format = meta_formats['datetime']
+        else:
+            self._format = self.input_formats[0]
`;

function ScrubBar({ pos, setPos, total, events }) {
  return (
    <div style={{display:"flex", flexDirection:"column", gap:6}}>
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <button className="tb-btn">⏮</button>
        <button className="tb-btn primary" style={{padding:"4px 10px"}}>▶ Play</button>
        <button className="tb-btn">⏭</button>
        <span className="mono dim2" style={{fontSize:11}}>{events[pos]?.t || "00:00"} / 01:09</span>
        <span style={{flex:1}}/>
        <span className="mono dim2" style={{fontSize:11}}>1.0×</span>
        <button className="tb-btn">↧ Export trace</button>
      </div>
      <div style={{position:"relative", height: 30, background:"var(--bg-2)", border:"1px solid var(--line)", borderRadius: 4}}>
        {events.map((e, i) => {
          const x = (i / (events.length - 1)) * 100;
          const c = e.k === "judge" ? "var(--accent)" : e.k === "thought" ? "#a8a8b0" : e.ok === false ? "var(--err)" : e.k === "system" ? "var(--fg-3)" : "#60a5fa";
          return <div key={i} onClick={() => setPos(i)} title={e.title}
            style={{position:"absolute", left: `${x}%`, top: 4, bottom: 4, width: 2, background: c, cursor:"pointer", opacity: i <= pos ? 1 : 0.4}} />;
        })}
        <div style={{position:"absolute", left: `${(pos/(events.length-1))*100}%`, top:-3, bottom:-3, width: 2, background:"var(--accent)", boxShadow:"0 0 0 3px rgba(245,165,36,0.2)"}} />
      </div>
      <div style={{display:"flex", justifyContent:"space-between", fontFamily:"var(--mono)", fontSize:10, color:"var(--fg-4)"}}>
        <span>plan</span><span>judge</span><span>implement</span><span>evaluate</span><span>done</span>
      </div>
    </div>
  );
}

function PageReplay() {
  const [pos, setPos] = React.useState(REPLAY_EVENTS.length - 3);
  const visible = REPLAY_EVENTS.slice(0, pos + 1);
  return (
    <main className="main">
      <Topbar crumbs={["benchmark","experiments","exp_3a91f","runs","r_z3k"]} />
      <PageHeader
        title="r_z3k · django__django-14238"
        sub="claude-sonnet-4.5 · pi-react/1.4 · 01:09 elapsed · 47 lines / 2 files · 24,118 tok · $0.74"
        right={
          <>
            <span className="status-pill s-resolved"><span className="dot"/>resolved</span>
            <button className="tb-btn">← Prev run</button>
            <button className="tb-btn">Next run →</button>
            <button className="tb-btn primary">Open in workspace</button>
          </>
        }
      />
      <div style={{padding:"16px 24px", display:"grid", gridTemplateColumns:"320px 1fr 360px", gap: 12}}>

        {/* LEFT: events timeline */}
        <div className="card" style={{padding: 0, display:"flex", flexDirection:"column", overflow:"hidden", maxHeight:"calc(100vh - 180px)"}}>
          <div style={{padding:"10px 14px", borderBottom:"1px solid var(--line)", fontSize:12, fontWeight:500, display:"flex", justifyContent:"space-between"}}>
            <span>Trace</span>
            <span className="mono dim2" style={{fontSize:10.5}}>{visible.length} / {REPLAY_EVENTS.length} events</span>
          </div>
          <div style={{overflow:"auto", padding: "8px 0"}}>
            {REPLAY_EVENTS.map((e, i) => {
              const active = i === pos;
              const dim = i > pos;
              return (
                <div key={i} onClick={() => setPos(i)} style={{
                  display:"grid", gridTemplateColumns:"42px 14px 1fr", gap: 8, padding:"6px 10px",
                  cursor:"pointer", background: active ? "rgba(245,165,36,0.05)" : "transparent",
                  borderLeft: "2px solid " + (active ? "var(--accent)" : "transparent"),
                  opacity: dim ? 0.45 : 1,
                }}>
                  <div className="mono" style={{fontSize:10.5, color:"var(--fg-3)"}}>{e.t}</div>
                  <div style={{
                    width: 8, height: 8, borderRadius: 2, marginTop: 4,
                    background: e.k === "judge" ? "var(--accent)" : e.k === "thought" ? "#a8a8b0" : e.ok === false ? "var(--err)" : e.k === "system" ? "var(--fg-3)" : "#60a5fa",
                  }}/>
                  <div>
                    <div style={{fontSize:11.5, color: active ? "var(--fg)" : "var(--fg-1)"}}>{e.title}</div>
                    <div className="mono dim2" style={{fontSize:10.5, marginTop: 1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{e.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER: focus */}
        <div style={{display:"flex", flexDirection:"column", gap: 12, minWidth: 0}}>
          <div className="card" style={{padding:"12px 14px"}}>
            <ScrubBar pos={pos} setPos={setPos} total={REPLAY_EVENTS.length} events={REPLAY_EVENTS} />
          </div>
          <div className="card" style={{padding:0, overflow:"hidden"}}>
            <div style={{display:"flex", alignItems:"center", gap: 10, padding:"10px 14px", borderBottom:"1px solid var(--line)"}}>
              <span className={"chip s-" + (REPLAY_EVENTS[pos]?.k || "system")} style={{fontFamily:"var(--mono)", fontSize:10}}>{REPLAY_EVENTS[pos]?.k}</span>
              <span style={{fontSize:13, fontWeight:500}}>{REPLAY_EVENTS[pos]?.title}</span>
              <span className="mono dim2" style={{marginLeft:"auto", fontSize:11}}>at {REPLAY_EVENTS[pos]?.t}</span>
            </div>
            <div style={{padding:"14px 16px", fontSize:12.5, lineHeight:1.6, color:"var(--fg-1)"}}>
              {REPLAY_EVENTS[pos]?.body}
            </div>
            {REPLAY_EVENTS[pos]?.out && (
              <pre style={{margin:"0 14px 14px"}}>{REPLAY_EVENTS[pos].out}</pre>
            )}
          </div>
          <div className="card" style={{padding:0, overflow:"hidden"}}>
            <div style={{display:"flex", alignItems:"center", gap: 10, padding:"10px 14px", borderBottom:"1px solid var(--line)"}}>
              <span style={{fontSize:12.5, fontWeight:500}}>Final patch</span>
              <span className="mono dim2" style={{fontSize:10.5}}>2 files · +18 −6</span>
              <span style={{flex:1}}/>
              <button className="tb-btn">Copy</button>
              <button className="tb-btn">View raw</button>
            </div>
            <pre style={{margin: 0, border:"none", borderRadius: 0, background: "var(--bg-1)"}}>{PATCH}</pre>
          </div>
        </div>

        {/* RIGHT: panels */}
        <div style={{display:"flex", flexDirection:"column", gap: 12}}>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Outcome</div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8}}>
              <div className="metric" style={{padding:0}}>
                <div className="lab">E2E</div>
                <div className="val" style={{color:"var(--ok)"}}>RESOLVED</div>
                <div className="sub">7/7 FAIL_TO_PASS</div>
              </div>
              <div className="metric" style={{padding:0}}>
                <div className="lab">PLAN SCORE</div>
                <div className="val">67%</div>
                <div className="sub">4/6 atoms matched</div>
              </div>
              <div className="metric" style={{padding:0}}>
                <div className="lab">COST</div>
                <div className="val">$0.74</div>
                <div className="sub">24,118 tok</div>
              </div>
              <div className="metric" style={{padding:0}}>
                <div className="lab">TURNS</div>
                <div className="val">11 / 50</div>
                <div className="sub">2 recoveries</div>
              </div>
            </div>
          </div>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Tool usage</div>
            {[
              ["fs.read", 4, "#60a5fa"],
              ["grep", 2, "#60a5fa"],
              ["str.replace", 3, "#c084fc"],
              ["shell.exec", 2, "#5eead4"],
            ].map(([n, c, col]) => (
              <div key={n} style={{display:"flex", alignItems:"center", gap: 8, padding:"4px 0"}}>
                <span className="mono" style={{fontSize:11, width: 100}}>{n}</span>
                <div style={{flex:1, height:4, background:"var(--bg-3)", borderRadius:2}}>
                  <div style={{width: `${c*10}%`, height:"100%", background:col, borderRadius:2}}/>
                </div>
                <span className="mono dim2" style={{fontSize:11, width: 18, textAlign:"right"}}>{c}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{padding:"12px 14px"}}>
            <div style={{fontSize:12, fontWeight:500, marginBottom:8}}>Compare across models</div>
            {[
              ["claude-sonnet-4.5","$0.74", true,  "RESOLVED"],
              ["claude-opus-4.1",  "$2.18", false, "RESOLVED"],
              ["gpt-5",            "$1.04", false, "RESOLVED"],
              ["gemini-2.5-pro",   "$0.31", false, "FAILED"],
              ["claude-haiku-4.5", "$0.18", false, "TIMEOUT"],
              ["deepseek-v3.2",    "$0.06", false, "FAILED"],
            ].map(([m,c,cur,r]) => (
              <div key={m} style={{display:"flex", alignItems:"center", gap: 8, padding:"5px 0", borderBottom:"1px solid var(--line)"}}>
                <span style={{fontSize:11.5, color: cur ? "var(--fg)" : "var(--fg-2)", flex:1}}>{m}{cur && <span className="mono dim2" style={{marginLeft:6, fontSize:10}}>(this)</span>}</span>
                <span className="mono" style={{fontSize:11}}>{c}</span>
                <span className={"chip s-" + (r === "RESOLVED" ? "resolved" : r === "FAILED" ? "failed" : "timeout")} style={{minWidth:64, justifyContent:"center"}}>{r.toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

window.PageReplay = PageReplay;
