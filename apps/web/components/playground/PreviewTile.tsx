"use client";

type PreviewTileProps = {
  url: string | null;
  status?: "ok" | "fail" | "pending";
  message?: string;
};

export function PreviewTile({ url, status = "ok", message }: PreviewTileProps) {
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;

  return (
    <div className="pg-preview">
      <div className="browser-bar">
        <div className="dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
        <div className="url">{safeUrl ?? message ?? "no app url yet"}</div>
      </div>
      {status === "fail" ? (
        <div
          style={{
            padding: 14,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--err)",
          }}
        >
          {message ?? "agent run failed"}
        </div>
      ) : safeUrl ? (
        <iframe
          src={safeUrl}
          title="agent preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{
            width: "100%",
            border: "none",
            background: "var(--paper)",
            display: "block",
            // The .pg-preview wrapper enforces aspect-ratio; iframe fills its
            // remaining height after the 32px browser bar.
            height: "calc(100% - 32px)",
          }}
        />
      ) : (
        <div
          className="browser-body"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-4)",
            fontStyle: "italic",
          }}
        >
          {message ?? "waiting for the agent to bind a port…"}
        </div>
      )}
    </div>
  );
}
