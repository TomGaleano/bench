"use client";

import type { ReactNode } from "react";

type StateProps = {
  variant: "info" | "warn" | "fail" | "muted";
  title: string;
  description: ReactNode;
  actions?: ReactNode | undefined;
  detail?: string | undefined;
};

export function PlaygroundStateCard({ variant, title, description, actions, detail }: StateProps) {
  return (
    <div className={`pg-err-card ${variant}`}>
      <div className="glyph">
        {variant === "fail" ? (
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M5 5l4 4M9 5l-4 4" />
          </svg>
        ) : variant === "warn" ? (
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 1l6 11H1z" />
            <path d="M7 5v4M7 11h.01" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M7 4v4M7 10h.01" />
          </svg>
        )}
      </div>
      <div className="ti">{title}</div>
      <div className="desc">{description}</div>
      {detail && <pre>{detail}</pre>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function NoModelsState({ onRetry }: { onRetry?: () => void }) {
  return (
    <PlaygroundStateCard
      variant="info"
      title="No models loaded yet."
      description={
        <>
          The OpenRouter catalog is warming. We read{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 11, background: "var(--paper-3)", padding: "1px 5px", borderRadius: 3 }}>
            /api/v1/models
          </code>{" "}
          on mount — usually under a second.
        </>
      }
      actions={
        onRetry ? (
          <button type="button" className="btn2 sm" onClick={onRetry}>
            Retry
          </button>
        ) : null
      }
    />
  );
}

export function NoApiKeyState() {
  return (
    <PlaygroundStateCard
      variant="warn"
      title="OpenRouter key missing."
      description={
        <>
          Set{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 11, background: "var(--paper-3)", padding: "1px 5px", borderRadius: 3 }}>
            OPENROUTER_API_KEY
          </code>{" "}
          on the worker before launching. Sessions queued without a key will fail at the first model call.
        </>
      }
    />
  );
}

export function SandboxFailureState({ detail, onRetry }: { detail?: string; onRetry?: () => void }) {
  return (
    <PlaygroundStateCard
      variant="fail"
      title="Sandbox provisioning failed."
      description="E2B couldn't allocate a sandbox for this session. Your queued session is held — you can release the slot or wait for the next pool refresh."
      detail={detail}
      actions={
        onRetry ? (
          <button type="button" className="btn2 sm primary" onClick={onRetry}>
            Retry now
          </button>
        ) : null
      }
    />
  );
}

export function AllAgentsFailedState({
  failures,
  onRetry,
}: {
  failures: Array<{ modelName: string; reason: string }>;
  onRetry?: () => void;
}) {
  return (
    <PlaygroundStateCard
      variant="muted"
      title="All agents failed."
      description={
        <>
          Every agent ended in error or timeout. Common cause: the task prompt is missing a launch
          instruction (no <em>"the app must listen on the assigned port"</em> phrasing).
        </>
      }
      detail={failures.map((f) => `· ${f.modelName} — ${f.reason}`).join("\n")}
      actions={
        onRetry ? (
          <button type="button" className="btn2 sm primary" onClick={onRetry}>
            Re-run with edits
          </button>
        ) : null
      }
    />
  );
}
