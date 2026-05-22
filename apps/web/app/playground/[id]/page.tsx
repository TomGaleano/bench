"use client";

import { use, useEffect, useState } from "react";
import { getPlaygroundSession, type PlaygroundSessionResponse } from "../../../lib/api";
import { SavedSessionView } from "../../../components/playground/SavedSessionView";

export default function PlaygroundSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [session, setSession] = useState<PlaygroundSessionResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPlaygroundSession(id)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="mdl-page">
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Couldn&rsquo;t load this session</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mdl-page">
        <div className="mdl-loading" style={{ padding: 24 }}>
          <span className="pulse" />
          loading session…
        </div>
      </div>
    );
  }

  return <SavedSessionView session={session} />;
}
