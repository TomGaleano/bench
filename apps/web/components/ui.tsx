import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  meta?: Array<[string, string]>;
};

export function PageHeader({ description, eyebrow, meta = [], title }: PageHeaderProps) {
  return (
    <header className="pageHeader">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {meta.length ? (
        <dl>
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

export function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="sectionTitle">
      <span>{kicker}</span>
      <h2>{title}</h2>
    </div>
  );
}

export function MetricCard({
  hint,
  label,
  tone = "accent",
  trend,
  value
}: {
  hint: string;
  label: string;
  tone?: "accent" | "cool" | "plum";
  trend: string;
  value: string;
}) {
  return (
    <article className={`metricCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
      <small>{trend}</small>
    </article>
  );
}

export function EmptyState({
  compact = false,
  description,
  title
}: {
  compact?: boolean;
  description: string;
  title: string;
}) {
  return (
    <div className={compact ? "emptyState compact" : "emptyState"}>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function LoadingState({ compact = false, label }: { compact?: boolean; label: string }) {
  return (
    <div className={compact ? "loadingState compact" : "loadingState"} aria-live="polite">
      <span />
      <p>{label}</p>
    </div>
  );
}

export function StatusPill({ status }: { status: string | undefined | null }) {
  const safe = status ?? "unknown";
  const normalized = safe.toLowerCase().replaceAll(" ", "-");
  return <span className={`statusPill ${normalized}`}>{safe}</span>;
}

export function InlineList({ children }: { children: ReactNode }) {
  return <div className="inlineList">{children}</div>;
}
