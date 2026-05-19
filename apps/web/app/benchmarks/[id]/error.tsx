"use client";

import { useEffect } from "react";

export default function BenchmarkDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Benchmark detail page error:", error);
  }, [error]);

  return (
    <div className="panel nextStepPanel">
      <div className="sectionTitle">
        <span>Error</span>
        <h2>Unable to load benchmark</h2>
      </div>
      <div className="callout error">
        <p>Something went wrong while fetching this benchmark.</p>
        {error.message ? <p><code>{error.message}</code></p> : null}
      </div>
      <div className="buttonRow">
        <button className="button primary" onClick={() => reset()} type="button">
          Try again
        </button>
        <a className="button" href="/benchmarks">
          All benchmarks
        </a>
        <a className="button" href="/benchmarks/new">
          New benchmark
        </a>
      </div>
    </div>
  );
}
