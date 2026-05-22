"use client";

import { use, useEffect, useState } from "react";
import {
  getSharedPlaygroundSession,
  type PlaygroundSessionResponse,
} from "../../../../lib/api";
import { SavedSessionView } from "../../../../components/playground/SavedSessionView";

export default function PlaygroundSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [session, setSession] = useState<PlaygroundSessionResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSharedPlaygroundSession(token)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div className="mdl-page">
        <div className="mdl-err" style={{ margin: "24px auto" }}>
          <h3>Share link not found</h3>
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
          loading shared session…
        </div>
      </div>
    );
  }

  return <SavedSessionView session={session} readOnlyShare />;
}
