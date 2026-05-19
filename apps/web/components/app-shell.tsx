"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { listRuns } from "../lib/api";

const labNav = [
  { href: "/", label: "Overview", count: null },
  { href: "/tasks", label: "Tasks", count: null },
  { href: "/cases/new", label: "New Case", count: null },
  { href: "/benchmarks", label: "Benchmarks", count: null },
  { href: "/experiments/new", label: "Experiment Setup", count: null },
  { href: "/runs", label: "Live Runs", count: null, live: true },
  { href: "/replay", label: "Replay", count: null },
  { href: "/grading", label: "Plan Grading", count: null }
];

const libraryNav = [
  { href: "/models", label: "Models" },
  { href: "/datasets", label: "Datasets" },
  { href: "/harnesses", label: "Harnesses" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="appShell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brandMark">pi</span>
          <span>
            <strong>Pi Lab</strong>
            <small>alignforge</small>
          </span>
        </Link>

        <NavSection title="Lab">
          {labNav.map((item) => (
            <Link
              className={pathname === item.href ? "navItem active" : "navItem"}
              href={item.href}
              key={item.href}
            >
              <span className="navIcon" aria-hidden="true" />
              <span>{item.label}</span>
              {item.live ? <span className="liveDot" aria-label="Live" /> : null}
              {item.count ? <small>{item.count}</small> : null}
            </Link>
          ))}
        </NavSection>

        <NavSection title="Library">
          {libraryNav.map((item) => (
            <Link
              className={pathname === item.href ? "navItem active" : "navItem"}
              href={item.href}
              key={item.href}
            >
              <span className="navIcon" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </NavSection>

        <div className="sidebarFoot">
          <span>build web-mvp</span>
          <span>online</span>
        </div>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div className="crumbs">
            <span>pi lab</span>
            <span>/</span>
            <strong>{currentLabel(pathname)}</strong>
            <LiveExperimentTag />
          </div>
          <div className="searchBox">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Global search" placeholder="Find run, task, model..." />
            <kbd>⌘K</kbd>
          </div>
          <a className="button" href="/tasks">Docs</a>
          <Link className="button primary" href="/experiments/new">New experiment</Link>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

function LiveExperimentTag() {
  const [running, setRunning] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const runs = await listRuns();
        if (cancelled) return;
        const active = runs.filter(
          (r) => r.status === "running" || r.status === "queued" || r.status === "pending",
        ).length;
        setRunning(active);
      } catch {
        if (!cancelled) setRunning(0);
      } finally {
        if (!cancelled) timer = setTimeout(tick, 15_000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (running <= 0) return null;
  return (
    <span className="liveTag">
      <span className="pip" />
      {running} {running === 1 ? "experiment" : "experiments"} running
    </span>
  );
}

function NavSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="navSection">
      <h2>{title}</h2>
      <nav>{children}</nav>
    </section>
  );
}

function currentLabel(pathname: string) {
  const lab = labNav.find((item) => item.href === pathname);
  if (lab) return lab.label.toLowerCase();
  const lib = libraryNav.find((item) => item.href === pathname);
  if (lib) return lib.label.toLowerCase();
  if (pathname.startsWith("/datasets/")) return "dataset";
  if (pathname.startsWith("/benchmarks/")) return "benchmark";
  return "overview";
}
