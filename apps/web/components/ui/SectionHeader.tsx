import type { ReactNode } from "react";

export function SectionHeader({
  children,
  num,
  sub,
}: {
  children: ReactNode;
  num: string;
  sub?: ReactNode;
}) {
  return (
    <>
      <div className="section-h">
        <span className="num">{num}</span>
        <span>{children}</span>
      </div>
      {sub && <div className="section-sub">{sub}</div>}
    </>
  );
}
