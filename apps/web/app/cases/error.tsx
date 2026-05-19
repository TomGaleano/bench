"use client";

import { useEffect } from "react";

export default function CasesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log to console for debugging
    console.error("Cases page error:", error);
  }, [error]);

  return (
    <div className="panel nextStepPanel">
      <div className="sectionTitle">
        <span>Error</span>
        <h2>Unable to load cases</h2>
      </div>
      <div className="callout error">
        <p>Something went wrong while fetching the cases list.</p>
        {error.message ? <p><code>{error.message}</code></p> : null}
      </div>
      <div className="buttonRow">
        <button className="button primary" onClick={() => reset()} type="button">
          Try again
        </button>
        <a className="button" href="/cases/new">
          Create a case
        </a>
      </div>
    </div>
  );
}
