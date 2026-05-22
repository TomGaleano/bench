import type { ReactNode } from "react";
import "./playground.css";

export default function PlaygroundLayout({ children }: { children: ReactNode }) {
  return <div className="pg-root">{children}</div>;
}
