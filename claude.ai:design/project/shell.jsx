/* shell.jsx — sidebar, topbar, page header */

const NAV = [
  { id: "dashboard.html",   key: "dashboard",   label: "Dashboard" },
  { id: "experiment.html",  key: "experiment",  label: "Experiments", count: 12 },
  { id: "monitor.html",     key: "monitor",     label: "Live Runs",  count: 16, live: true },
  { id: "replay.html",      key: "replay",      label: "Run Replay" },
  { id: "planning.html",    key: "planning",    label: "Plan Score" },
  { id: "task.html",        key: "task",        label: "Tasks", count: 500 },
];

const NAV_LIB = [
  { id: "models.html",  key: "models",  label: "Models", count: 12 },
  { id: "harnesses.html", key: "harnesses", label: "Harnesses", count: 4 },
  { id: "datasets.html", key: "datasets", label: "Datasets", count: 7 },
  { id: "settings.html", key: "settings", label: "Settings" },
];

function Sidebar({ active }) {
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="glyph">π</div>
        <div className="brand-text">Benchmark</div>
        <div className="org">/ alignforge</div>
      </div>

      <div className="sb-section">Lab</div>
      <nav className="sb-nav">
        {NAV.map(n => (
          <a key={n.key} href={n.id} className={"sb-link" + (active === n.key ? " active" : "")}>
            <span className="ico">{ICONS[n.key] || ICONS.default}</span>
            <span className="lbl">{n.label}</span>
            {n.live && <span className="live-pip" />}
            {n.count != null && <span className="badge">{n.count}</span>}
          </a>
        ))}
      </nav>

      <div className="sb-section">Library</div>
      <nav className="sb-nav">
        {NAV_LIB.map(n => (
          <a key={n.key} href={n.id} className={"sb-link" + (active === n.key ? " active" : "")}>
            <span className="ico">{ICONS[n.key] || ICONS.default}</span>
            <span className="lbl">{n.label}</span>
            {n.count != null && <span className="badge">{n.count}</span>}
          </a>
        ))}
      </nav>

      <div className="sb-foot">
        <span className="mono">build a3f1c2d</span>
        <span style={{color:"var(--ok)"}}>● online</span>
      </div>
    </aside>
  );
}

function Topbar({ crumbs = [], extras }) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "cur" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="tb-spacer" />
      <div className="tb-search">
        <span style={{opacity:0.5}}>⌕</span>
        <input placeholder="Find run, task, model…" />
        <span className="kbd">⌘K</span>
      </div>
      {extras}
      <button className="tb-btn">Docs</button>
      <button className="tb-btn primary">+ New experiment</button>
    </div>
  );
}

function PageHeader({ title, sub, right }) {
  return (
    <div className="page-hd">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

const ICONS = {
  dashboard: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="4" height="4"/><rect x="8" y="2" width="4" height="4"/><rect x="2" y="8" width="4" height="4"/><rect x="8" y="8" width="4" height="4"/></svg>,
  experiment: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v4l-3 5a1 1 0 0 0 1 1.5h8a1 1 0 0 0 1-1.5L9 6V2M4 2h6"/></svg>,
  monitor: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 7l2-3 2 6 2-4 2 3 2-2"/></svg>,
  replay: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5"/><path d="M5 5v4l4-2z" fill="currentColor"/></svg>,
  planning: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 11V3M3 11h8M5 8l2-3 2 2 2-4"/></svg>,
  task: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="10" height="10" rx="1.5"/><path d="M4.5 7l1.5 1.5L10 4.5"/></svg>,
  models: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2"/><circle cx="7" cy="7" r="5"/></svg>,
  harnesses: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="10" height="8" rx="1"/><path d="M5 3v8M9 3v8"/></svg>,
  datasets: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="7" cy="3.5" rx="4" ry="1.5"/><path d="M3 3.5v7c0 .8 1.8 1.5 4 1.5s4-.7 4-1.5v-7"/></svg>,
  settings: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.5 1.5M9.5 9.5L11 11M3 11l1.5-1.5M9.5 4.5L11 3"/></svg>,
  default: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="3"/></svg>,
};

window.Sidebar = Sidebar;
window.Topbar = Topbar;
window.PageHeader = PageHeader;
