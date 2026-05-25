"use client";

import { useEffect, useRef, useState } from "react";

type AgentMoreMenuProps = {
  onStop?: () => void;
  onCopyTranscript?: () => void;
  canStop?: boolean;
  disabled?: boolean;
};

export function AgentMoreMenu({ onStop, onCopyTranscript, canStop, disabled }: AgentMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(ev: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="pg-iconbtn"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="7" r="1" />
          <circle cx="7" cy="7" r="1" />
          <circle cx="10.5" cy="7" r="1" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
            minWidth: 160,
            zIndex: 30,
            padding: 4,
          }}
        >
          <MenuItem
            label="Stop agent"
            disabled={!canStop}
            onClick={() => {
              setOpen(false);
              onStop?.();
            }}
          />
          <MenuItem
            label="Copy transcript"
            onClick={() => {
              setOpen(false);
              onCopyTranscript?.();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        color: disabled ? "var(--ink-5)" : "var(--ink-2)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "var(--paper-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}
