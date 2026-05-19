import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PageHeader, SectionTitle, StatusPill } from "../../components/ui";

export default function SettingsPage() {
  const rootEnv = readRootEnv();
  const runtimeConfigured = Boolean(process.env.DAYTONA_API_KEY ?? rootEnv.DAYTONA_API_KEY);
  const apiUrl = process.env.DAYTONA_API_URL ?? rootEnv.DAYTONA_API_URL ?? "http://localhost:3000/api";

  return (
    <div className="pageStack">
      <PageHeader
        eyebrow="Runtime"
        title="Sandbox settings"
        description="Benchmark commands now run through the unified Daytona runtime. Workers fail closed when Daytona is not configured instead of falling back to host execution."
        meta={[
          ["provider", "Daytona"],
          ["status", runtimeConfigured ? "configured" : "missing key"],
        ]}
      />

      <section className="panel stackGap">
        <SectionTitle kicker="Execution" title="Unified runtime" />
        <div className="detailGrid">
          <div>
            <span>API URL</span>
            <strong>{apiUrl}</strong>
          </div>
          <div>
            <span>API key</span>
            <strong><StatusPill status={runtimeConfigured ? "configured" : "required"} /></strong>
          </div>
          <div>
            <span>Sandbox lifecycle</span>
            <strong>ephemeral, delete on completion</strong>
          </div>
          <div>
            <span>Host fallback</span>
            <strong>disabled</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function readRootEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(process.cwd(), "../../.env"), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)] as const;
        }),
    );
  } catch {
    return {};
  }
}
