/* app-bootstrap.jsx — global Tweaks + page mount */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#f5a524",
  "density": "comfortable",
  "statusMode": "mono",
  "showCostMeters": true,
  "monitorView": "grid",
  "streamSpeed": 1.0
}/*EDITMODE-END*/;

function applyTweaks(t) {
  document.documentElement.style.setProperty("--accent", t.accent);
  document.documentElement.style.setProperty("--accent-soft", t.accent + "1F");
  document.documentElement.style.setProperty("--accent-line", t.accent + "55");
  document.body.dataset.density    = t.density;
  document.body.dataset.statusMode = t.statusMode;
  document.body.dataset.costMeters = t.showCostMeters ? "on" : "off";
  document.body.dataset.monitorView = t.monitorView;
  window.__streamSpeed = t.streamSpeed;
}

function GlobalTweaks() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => applyTweaks(t), [t]);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme" />
      <TweakColor label="Accent" value={t.accent} onChange={(v)=>setTweak("accent",v)} />
      <TweakRadio label="Density" value={t.density}
        options={[{value:"compact",label:"Compact"},{value:"comfortable",label:"Comfy"}]}
        onChange={(v)=>setTweak("density",v)} />
      <TweakRadio label="Status colors" value={t.statusMode}
        options={[{value:"mono",label:"Mono"},{value:"traffic",label:"Traffic"},{value:"spectrum",label:"Spectrum"}]}
        onChange={(v)=>setTweak("statusMode",v)} />
      <TweakToggle label="Show cost meters" value={t.showCostMeters} onChange={(v)=>setTweak("showCostMeters",v)} />
      <TweakSection label="Live monitor" />
      <TweakRadio label="View mode" value={t.monitorView}
        options={[{value:"grid",label:"Grid"},{value:"lane",label:"Lane"},{value:"list",label:"List"}]}
        onChange={(v)=>setTweak("monitorView",v)} />
      <TweakSlider label="Stream speed" value={t.streamSpeed} min={0} max={3} step={0.1} unit="×"
                   onChange={(v)=>setTweak("streamSpeed",v)} />
    </TweaksPanel>
  );
}

function App({ page }) {
  const PAGES = {
    dashboard:  PageDashboard,
    experiment: window.PageExperiment,
    monitor:    window.PageMonitor,
    replay:     window.PageReplay,
    planning:   window.PagePlanning,
    task:       window.PageTask,
  };
  const Page = PAGES[page] || (() => <div style={{padding:24}}>Page not found</div>);
  const NAV_KEY = {
    dashboard: "dashboard", experiment: "experiment", monitor: "monitor",
    replay: "replay", planning: "planning", task: "task",
  }[page];
  return (
    <>
      <div className="app">
        <Sidebar active={NAV_KEY} />
        <Page />
      </div>
      <GlobalTweaks />
    </>
  );
}

const PAGE = (function() {
  const all = document.querySelectorAll("script[data-page]");
  return all[all.length-1]?.dataset?.page || "dashboard";
})();

ReactDOM.createRoot(document.getElementById("root")).render(<App page={PAGE} />);
