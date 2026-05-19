import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

type HeroProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  meta?: Array<[string, ReactNode]> | undefined;
  actions?: ReactNode;
  live?: boolean;
};

export function Hero({ actions, eyebrow, lede, live, meta, title }: HeroProps) {
  return (
    <div className="hero2">
      <div className="hero2-main">
        <Eyebrow live={live ?? false}>{eyebrow}</Eyebrow>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {(meta && meta.length > 0) || actions ? (
        <div className="hero2-meta">
          {meta?.map(([label, value]) => (
            <div className="hero2-meta-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
          {actions && <div className="hero2-actions">{actions}</div>}
        </div>
      ) : null}
    </div>
  );
}
