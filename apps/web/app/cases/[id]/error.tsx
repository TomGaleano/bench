"use client";

import { useEffect } from "react";

export default function CaseDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Case detail page error:", error);
  }, [error]);

  return (
    <div className="panel nextStepPanel">
      <div className="sectionTitle">
        <span>Error</span>
        <h2>Unable to load case</h2>
      </div>
      <div className="callout error">
        <p>Something went wrong while fetching this case.</p>
        {error.message ? <p><code>{error.message}</code></p> : null}
      </div>
      <div className="buttonRow">
        <button className="button primary" onClick={() => reset()} type="button">
          Try again
        </button>
        <a className="button" href="/cases">
          All cases
        </a>
        <a className="button" href="/cases/new">
          New case
        </a>
      </div>
    </div>
  );
}
