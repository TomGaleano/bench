/* shell-v2.jsx — light editorial nav */

const NAV2 = [
  { id: "dashboard.html",  key: "dashboard",  label: "Overview" },
  { id: "experiment.html", key: "experiment", label: "Experiments", count: 12 },
  { id: "monitor.html",    key: "monitor",    label: "Live runs",  count: 16, live: true },
  { id: "replay.html",     key: "replay",     label: "Replays" },
  { id: "planning.html",   key: "planning",   label: "Plan grading" },
  { id: "task.html",       key: "task",       label: "Tasks", count: 500 },
];
const NAV2_LIB = [
  { id: "dashboard.html#models",  key: "models",  label: "Models", count: 12 },
  { id: "dashboard.html#harness", key: "harnesses", label: "Harnesses", count: 4 },
  { id: "dashboard.html#data",    key: "datasets", label: "Datasets", count: 7 },
  { id: "dashboard.html#settings",key: "settings", label: "Settings" },
];

function Sidebar2({ active }) {
  return (
    <aside className="sb2">
      <div className="sb2-brand">
        <div className="sb2-mark">π</div>
        <div className="sb2-name">Pi Lab</div>
        <div className="sb2-org">alignforge</div>
      </div>

      <div className="sb2-section">Lab</div>
      <nav style={{display:"flex", flexDirection:"column", gap:2}}>
        {NAV2.map(n => (
          <a key={n.key} href={n.id} className={"sb2-link" + (active === n.key ? " active" : "")}>
            <span className="ico">{ICON2[n.key] || ICON2.default}</span>
            <span>{n.label}</span>
            {n.live && <span className="live-pip" />}
            {n.count != null && <span className="badge2">{n.count}</span>}
          </a>
        ))}
      </nav>

      <div className="sb2-section">Library</div>
      <nav style={{display:"flex", flexDirection:"column", gap:2}}>
        {NAV2_LIB.map(n => (
          <a key={n.key} href={n.id} className="sb2-link">
            <span className="ico">{ICON2[n.key] || ICON2.default}</span>
            <span>{n.label}</span>
            {n.count != null && <span className="badge2">{n.count}</span>}
          </a>
        ))}
      </nav>

      <div className="sb2-foot">
        <span>build a3f1c2d</span>
        <span className="ok">● online</span>
      </div>
    </aside>
  );
}

function Topbar2({ crumbs = [], extras }) {
  return (
    <div className="tb2">
      <div className="crumbs2">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "cur" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="tb2-spacer" />
      <div className="tb2-search">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5.5" cy="5.5" r="3.5"/><path d="M8.5 8.5L11 11"/></svg>
        <input placeholder="Find run, task, model…" />
        <span className="kbd2">⌘K</span>
      </div>
      {extras}
      <button className="btn2">Docs</button>
      <button className="btn2 primary">+ New experiment</button>
    </div>
  );
}

const ICON2 = {
  dashboard:  <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 11V6l5-4 5 4v5"/><path d="M5 11V8h4v3"/></svg>,
  experiment: <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v4l-3 5a1 1 0 0 0 1 1.5h8a1 1 0 0 0 1-1.5L9 6V2M4 2h6"/></svg>,
  monitor:    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2"/><circle cx="7" cy="7" r="5"/></svg>,
  replay:     <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5"/><path d="M5 5v4l4-2z" fill="currentColor"/></svg>,
  planning:   <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 11V3M3 11h8M5 8l2-3 2 2 2-4"/></svg>,
  task:       <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="10" height="10" rx="1.5"/><path d="M4.5 7l1.5 1.5L10 4.5"/></svg>,
  models:     <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2"/><circle cx="7" cy="7" r="5"/></svg>,
  harnesses:  <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="10" height="8" rx="1"/><path d="M5 3v8M9 3v8"/></svg>,
  datasets:   <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="7" cy="3.5" rx="4" ry="1.5"/><path d="M3 3.5v7c0 .8 1.8 1.5 4 1.5s4-.7 4-1.5v-7"/></svg>,
  settings:   <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2"/></svg>,
  default:    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="3"/></svg>,
};

window.Sidebar2 = Sidebar2;
window.Topbar2 = Topbar2;
