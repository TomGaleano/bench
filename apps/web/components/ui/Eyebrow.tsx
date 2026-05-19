import type { ReactNode } from "react";

export function Eyebrow({
  children,
  dot = true,
  live = false,
}: {
  children: ReactNode;
  dot?: boolean;
  live?: boolean;
}) {
  return (
    <div className={"eyebrow" + (live ? " live" : "")}>
      {dot && <span className="eyebrowDot" aria-hidden="true" />}
      {children}
    </div>
  );
}
