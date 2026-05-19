"use client";

import { useEffect } from "react";

export default function BenchmarksError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Benchmarks page error:", error);
  }, [error]);

  return (
    <div className="panel nextStepPanel">
      <div className="sectionTitle">
        <span>Error</span>
        <h2>Unable to load benchmarks</h2>
      </div>
      <div className="callout error">
        <p>Something went wrong while fetching the benchmarks list.</p>
        {error.message ? <p><code>{error.message}</code></p> : null}
      </div>
      <div className="buttonRow">
        <button className="button primary" onClick={() => reset()} type="button">
          Try again
        </button>
        <a className="button" href="/benchmarks/new">
          New benchmark
        </a>
      </div>
    </div>
  );
}
