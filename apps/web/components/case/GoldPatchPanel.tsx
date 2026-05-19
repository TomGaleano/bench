type GoldPatchPanelProps = {
  patch: string | null;
  commitSha: string | null;
};

export function GoldPatchPanel({ commitSha, patch }: GoldPatchPanelProps) {
  if (!patch) {
    return (
      <div className="gold-patch empty">
        <strong>No gold patch attached</strong>
        <p>
          The gold patch hasn&apos;t been imported yet. Run case-builder against the linked PR to
          populate it.
        </p>
      </div>
    );
  }

  const lines = patch.split("\n").slice(0, 240);

  return (
    <div className="gold-patch">
      <div className="card2-hd">
        <span className="card2-ti">Gold patch</span>
        {commitSha && (
          <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>
            sha {commitSha.slice(0, 12)}
          </span>
        )}
      </div>
      <pre className="diff2">
        {lines.map((line, i) => {
          let cls = "ctx";
          if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
          else if (line.startsWith("@@")) cls = "hunk";
          else if (line.startsWith("+")) cls = "add";
          else if (line.startsWith("-")) cls = "del";
          return (
            <span key={i} className={`diff-line ${cls}`}>
              {line || " "}
            </span>
          );
        })}
        {patch.split("\n").length > 240 && (
          <span className="diff-line ctx" style={{ color: "var(--ink-4)" }}>
            … {patch.split("\n").length - 240} more lines
          </span>
        )}
      </pre>
    </div>
  );
}
