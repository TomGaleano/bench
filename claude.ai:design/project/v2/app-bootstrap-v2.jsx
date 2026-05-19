/* app-bootstrap-v2.jsx */

const TWEAK_DEFAULTS_V2 = /*EDITMODE-BEGIN*/{
  "accent": "#ff6a00",
  "serifTitles": true
}/*EDITMODE-END*/;

function applyTweaks2(t) {
  document.documentElement.style.setProperty("--accent", t.accent);
  document.documentElement.style.setProperty("--accent-soft", t.accent + "1A");
  document.documentElement.style.setProperty("--accent-2", t.accent + "AA");
}

function GlobalTweaks2() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS_V2);
  React.useEffect(() => applyTweaks2(t), [t]);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme"/>
      <TweakColor label="Accent" value={t.accent} onChange={(v)=>setTweak("accent",v)}/>
      <TweakToggle label="Serif titles" value={t.serifTitles} onChange={(v)=>setTweak("serifTitles",v)}/>
    </TweaksPanel>
  );
}

function App2({ page }) {
  const PAGES = {
    dashboard:  window.PageDashboard2,
    experiment: window.PageExperiment2,
    monitor:    window.PageMonitor2,
    replay:     window.PageReplay2,
    planning:   window.PagePlanning2,
    task:       window.PageTask2,
  };
  const Page = PAGES[page] || (() => <div style={{padding:24}}>Page not found: {page}</div>);
  return (
    <>
      <div className="app2">
        <Sidebar2 active={page}/>
        <Page/>
      </div>
      <GlobalTweaks2/>
    </>
  );
}

const PAGE2 = (function() {
  const all = document.querySelectorAll("script[data-page]");
  return all[all.length-1]?.dataset?.page || "dashboard";
})();

ReactDOM.createRoot(document.getElementById("root")).render(<App2 page={PAGE2}/>);
