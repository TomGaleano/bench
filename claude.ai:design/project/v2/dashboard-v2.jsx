/* dashboard-v2.jsx — editorial light theme */

function Sparkline({ data, color = "currentColor", w = 80, h = 22, fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const dx = w / (data.length - 1);
  const pts = data.map((v, i) => [i*dx, h - ((v-min)/range)*h]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{color}}>
      {fill && <path d={path + ` L ${w} ${h} L 0 ${h} Z`} fill="currentColor" opacity="0.08"/>}
      <path d={path} fill="none" strokeWidth="1.4"/>
      {pts.map((p, i) => i === pts.length-1 && <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="currentColor"/>)}
    </svg>
  );
}

function RaceChart({ rows }) {
  // multi-week trend lines, animated draw-on
  const w = 720, h = 200, pad = 30;
  const points = rows[0].trend.length;
  const maxV = Math.max(...rows.flatMap(r => r.trend));
  const minV = Math.min(...rows.flatMap(r => r.trend));
  const range = maxV - minV || 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {/* gridlines */}
      {[0,0.25,0.5,0.75,1].map((p, i) => (
        <line key={i} x1={pad} x2={w-pad} y1={pad + p*(h-2*pad)} y2={pad + p*(h-2*pad)}
              stroke="var(--rule)" strokeDasharray={p===0||p===1?"":"2,3"} strokeWidth="1" />
      ))}
      {/* y labels */}
      {[0,0.5,1].map((p, i) => {
        const v = (maxV - p*range).toFixed(0);
        return <text key={i} x={pad-6} y={pad + p*(h-2*pad) + 3} textAnchor="end"
          fontFamily="var(--mono)" fontSize="9" fill="var(--ink-4)">{v}%</text>;
      })}
      {/* x labels */}
      {["w-5","w-4","w-3","w-2","w-1","now"].map((l, i) => {
        const x = pad + (i/(points-1))*(w-2*pad);
        return <text key={l} x={x} y={h-8} textAnchor="middle"
          fontFamily="var(--mono)" fontSize="9" fill="var(--ink-4)">{l}</text>;
      })}
      {/* lines */}
      {rows.map((r, ri) => {
        const pts = r.trend.map((v, i) => {
          const x = pad + (i/(points-1))*(w-2*pad);
          const y = pad + (1 - (v-minV)/range) * (h-2*pad);
          return [x, y];
        });
        const d = pts.map((p, i) => (i===0?"M":"L")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
        const isLead = ri === 0;
        const color = isLead ? "var(--accent)" : ri === 1 ? "var(--ink)" : ri === 2 ? "var(--cool)" : ri === 3 ? "var(--plum)" : "var(--ink-4)";
        return (
          <g key={r.model} style={{opacity: ri < 5 ? 1 : 0.4}}>
            <path d={d} fill="none" stroke={color} strokeWidth={isLead?2:1.4} strokeLinejoin="round"
                  style={{strokeDasharray: 800, strokeDashoffset: 800, animation: `drawLine 1400ms ${ri*60}ms cubic-bezier(0.2,0.8,0.2,1) forwards`}}/>
            <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={isLead?4:3} fill={color}/>
            <text x={pts[pts.length-1][0]+8} y={pts[pts.length-1][1]+3}
              fontFamily="var(--mono)" fontSize="10" fill={color}>{r.short || r.model.split("-").slice(0,2).join("-")}</text>
          </g>
        );
      })}
      <style>{`@keyframes drawLine { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
}

function CostScatter({ rows }) {
  // x = cost / resolved, y = e2e score; pareto frontier
  const w = 360, h = 220, pad = 28;
  const xs = rows.map(r => r.costRes), ys = rows.map(r => r.e2e);
  const xMin = 0, xMax = Math.max(...xs)*1.1;
  const yMin = Math.min(...ys)-5, yMax = Math.max(...ys)+5;
  // Pareto: keep points that aren't dominated (lower x AND higher y)
  const pareto = rows.filter(r =>
    !rows.some(o => o !== r && o.costRes <= r.costRes && o.e2e >= r.e2e && (o.costRes < r.costRes || o.e2e > r.e2e))
  ).sort((a,b) => a.costRes - b.costRes);
  const px = (v) => pad + (v-xMin)/(xMax-xMin) * (w-2*pad);
  const py = (v) => h-pad - (v-yMin)/(yMax-yMin) * (h-2*pad);
  const paretoPath = pareto.map((r, i) => (i===0?"M":"L") + px(r.costRes) + " " + py(r.e2e)).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {/* axes */}
      <line x1={pad} x2={w-pad} y1={h-pad} y2={h-pad} stroke="var(--rule-2)"/>
      <line x1={pad} x2={pad} y1={pad} y2={h-pad} stroke="var(--rule-2)"/>
      {/* pareto frontier */}
      <path d={paretoPath} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.6"/>
      <text x={w-pad} y={h-pad+14} textAnchor="end" fontFamily="var(--mono)" fontSize="9.5" fill="var(--ink-4)">cost / resolved →</text>
      <text x={pad-6} y={pad-4} textAnchor="end" fontFamily="var(--mono)" fontSize="9.5" fill="var(--ink-4)">e2e %</text>
      {/* points */}
      {rows.map((r, i) => {
        const isPareto = pareto.includes(r);
        return (
          <g key={r.model}>
            <circle cx={px(r.costRes)} cy={py(r.e2e)} r={isPareto?5:3.5}
              fill={isPareto ? "var(--accent)" : "var(--ink)"}
              stroke="var(--paper)" strokeWidth="2"
              style={{transformOrigin:`${px(r.costRes)}px ${py(r.e2e)}px`, animation:`popIn 500ms ${i*40}ms cubic-bezier(0.2,0.8,0.2,1) both`}}/>
            {isPareto && <text x={px(r.costRes)+8} y={py(r.e2e)+3}
              fontFamily="var(--mono)" fontSize="10" fill="var(--ink)">{r.model.split("-")[0]}</text>}
          </g>
        );
      })}
      <style>{`@keyframes popIn { from { transform: scale(0); } to { transform: scale(1); } }`}</style>
    </svg>
  );
}

function PageDashboard2() {
  const top = LEADERBOARD.slice().sort((a,b) => b.e2e - a.e2e);

  return (
    <main className="main2">
      <Topbar2 crumbs={["pi lab","overview"]} />
      <div className="page2">
        <div className="hero2 rise">
          <div>
            <div className="eyebrow">
              <span>SWE-Bench Verified · v25.04</span>
              <span style={{color:"var(--ink-5)"}}>·</span>
              <span className="tag2 live"><span className="pip" style={{background:"var(--accent)"}}/>1 experiment running</span>
              <span style={{color:"var(--ink-5)"}}>·</span>
              <span>last sync 2m ago</span>
            </div>
            <h1>The frontier <em>moved</em> this&nbsp;week.</h1>
            <p className="lede">
              Twelve models, five hundred verified tasks, four harness configurations.
              Resolution rate climbed <b style={{color:"var(--accent)"}}>+2.4 points</b> against last week's leader,
              with cost-per-resolved-issue down 18%. <span className="dim italic">— observed at 14:02 UTC</span>
            </p>
          </div>
          <div className="meta">
            <div><b>1,842</b> runs · 7d</div>
            <div><b>$842.07</b> spent · 7d</div>
            <div>budget: <b>$2,000</b> / mo</div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="kpi-strip rise d1">
          <div className="kpi-cell">
            <div className="lab">Best E2E score</div>
            <div className="val">54.6<em>%</em></div>
            <div className="sub"><span>claude-opus-4.1</span><span className="delta up">▲ 1.4 wk</span></div>
            <div className="spark" style={{color:"var(--accent)"}}><Sparkline data={[40,44,49,52,55,58]} fill /></div>
          </div>
          <div className="kpi-cell">
            <div className="lab">Best plan score</div>
            <div className="val">81.2<em>%</em></div>
            <div className="sub"><span>claude-opus-4.1</span><span className="delta up">▲ 2.4 wk</span></div>
            <div className="spark" style={{color:"var(--ink)"}}><Sparkline data={[68,72,75,78,80,81]} /></div>
          </div>
          <div className="kpi-cell">
            <div className="lab">Lowest $/resolved</div>
            <div className="val">$0.10</div>
            <div className="sub"><span>gemini-2.5-flash</span><span className="delta dn">▼ 4.2% wk</span></div>
            <div className="spark" style={{color:"var(--cool)"}}><Sparkline data={[18,16,14,13,12,10]}/></div>
          </div>
          <div className="kpi-cell">
            <div className="lab">Runs · 7d</div>
            <div className="val">1,842</div>
            <div className="sub"><span>+312 vs prior</span><span className="delta up">▲ 20.4%</span></div>
            <div className="spark" style={{color:"var(--plum)"}}><Sparkline data={[140,180,210,240,260,310]} fill /></div>
          </div>
        </div>

        {/* Active experiment + Cost frontier */}
        <div className="grid g2 gap-16" style={{gridTemplateColumns:"1.5fr 1fr", marginTop: 16}}>
          <div className="card2 elev rise d2" style={{padding:"18px 22px"}}>
            <div className="row gap-8" style={{marginBottom: 6}}>
              <span className="tag2 live"><span className="pip"/>running</span>
              <span style={{fontFamily:"var(--mono)", fontSize:11, color:"var(--ink-4)"}}>exp_3a91f · 08:42 elapsed</span>
              <a href="monitor.html" className="btn2 sm right">Open monitor →</a>
            </div>
            <div className="serif" style={{fontSize: 28, letterSpacing:"-0.015em", marginTop: 4}}>
              <span style={{fontStyle:"italic"}}>frontier-x-cheap-impl</span>
            </div>
            <div className="dim mono" style={{fontSize: 11.5, marginTop: 4}}>6 models × 16 tasks · pi-react/1.4 · 56 done · 9 active · 23 queued</div>
            <div style={{display:"flex", height: 8, borderRadius: 4, overflow:"hidden", marginTop: 14, background:"var(--paper-3)"}}>
              <div style={{flex: 56, background:"var(--ok)", animation:"growBar 900ms cubic-bezier(0.2,0.8,0.2,1)"}}/>
              <div style={{flex: 8, background:"var(--err)", animation:"growBar 900ms 80ms cubic-bezier(0.2,0.8,0.2,1)"}}/>
              <div style={{flex: 9, background:"var(--accent)", animation:"growBar 900ms 160ms cubic-bezier(0.2,0.8,0.2,1)"}}/>
            </div>
            <div className="row gap-16" style={{marginTop: 14, fontFamily:"var(--mono)", fontSize: 11}}>
              <span><b style={{fontFamily:"var(--serif)", fontSize: 17}}>56</b> done</span>
              <span><b style={{fontFamily:"var(--serif)", fontSize: 17, color:"var(--err)"}}>8</b> failed</span>
              <span><b style={{fontFamily:"var(--serif)", fontSize: 17, color:"var(--accent)"}}>9</b> active</span>
              <span><b style={{fontFamily:"var(--serif)", fontSize: 17, color:"var(--ink-4)"}}>23</b> queued</span>
              <span className="right">$28.40 / $60.00</span>
            </div>
          </div>
          <div className="card2 rise d3" style={{padding:"16px 18px"}}>
            <div className="row" style={{marginBottom: 10}}>
              <span className="card2-ti">Cost · accuracy frontier</span>
              <span className="mono right" style={{fontSize:10.5, color:"var(--ink-4)"}}>pareto-optimal in <span style={{color:"var(--accent)"}}>orange</span></span>
            </div>
            <CostScatter rows={LEADERBOARD}/>
          </div>
        </div>

        {/* race chart */}
        <div className="section-h"><span className="num">02</span> Six weeks of <em>frontier motion</em></div>
        <div className="card2 rise" style={{padding:"22px 26px"}}>
          <RaceChart rows={LEADERBOARD.slice(0, 6)}/>
        </div>

        {/* Leaderboard */}
        <div className="section-h"><span className="num">03</span> Leaderboard <em>—</em> 12 models</div>
        <div className="section-sub">Sorted by end-to-end resolution rate. Bars within each column are normalized to that column's max for visual comparison.</div>
        <div className="lb rise">
          <div className="lb-row head">
            <div>#</div><div>Model</div><div>Plan</div><div>Implement</div><div>End-to-end</div><div>$/task</div><div>$/resolved</div><div style={{textAlign:"right"}}>6wk</div>
          </div>
          {top.map((r, i) => {
            const planMax = Math.max(...top.map(x=>x.plan));
            const implMax = Math.max(...top.map(x=>x.impl));
            const e2eMax  = Math.max(...top.map(x=>x.e2e));
            return (
              <div key={r.model} className={"lb-row" + (i===0?" lead":"")}>
                <div className="lb-rank">{String(i+1).padStart(2,"0")}</div>
                <div className="lb-model">
                  <span className="name">{r.model}</span>
                  <span className="vendor">{(MODELS.find(m=>m.id===r.model)||{}).vendor || "—"} · {r.harness}</span>
                </div>
                <div className="bar2">
                  <span className="v">{r.plan.toFixed(1)}</span>
                  <span className="track"><i style={{width: (r.plan/planMax*100)+"%", animationDelay: (i*40)+"ms"}}/></span>
                </div>
                <div className="bar2">
                  <span className="v">{r.impl.toFixed(1)}</span>
                  <span className="track"><i style={{width: (r.impl/implMax*100)+"%", animationDelay: (i*40+60)+"ms"}}/></span>
                </div>
                <div className="bar2 accent">
                  <span className="v" style={{color: i===0?"var(--accent)":"var(--ink)"}}>{r.e2e.toFixed(1)}</span>
                  <span className="track"><i style={{width: (r.e2e/e2eMax*100)+"%", animationDelay: (i*40+120)+"ms"}}/></span>
                </div>
                <div className="lb-cost">${r.costTask.toFixed(2)}</div>
                <div className="lb-cost">${r.costRes.toFixed(2)}</div>
                <div style={{textAlign:"right", color: r.delta >= 0 ? "var(--ok)" : "var(--err)"}}>
                  <Sparkline data={r.trend} color={i===0?"var(--accent)":"var(--ink-3)"}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* footnote */}
        <div className="row gap-12" style={{marginTop: 24, color: "var(--ink-4)", fontFamily:"var(--mono)", fontSize: 11}}>
          <span>Methodology: SWE-Bench Verified v25.04, 50-turn ReAct harness unless noted.</span>
          <span className="right">Curated by alignforge · Updated continuously</span>
        </div>
      </div>
    </main>
  );
}

window.PageDashboard2 = PageDashboard2;
window.Sparkline = Sparkline;
