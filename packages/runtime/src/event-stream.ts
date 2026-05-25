export type AgentEventKind =
  | "status"
  | "assistant_text_delta"
  | "tool_call_started"
  | "tool_call_delta"
  | "tool_call_finished"
  | "port_open"
  | "url_resolved"
  | "error"
  | "user_follow_up"
  | "turn_complete";

export type AppendEventBody = {
  agentRunId: string;
  seq: number;
  kind: AgentEventKind;
  payload?: Record<string, unknown>;
};

export type RunUpdateBody = {
  status?: "queued" | "preparing" | "running" | "succeeded" | "failed";
  sandboxId?: string;
  appUrl?: string;
  output?: string;
  startedAt?: string;
  finishedAt?: string;
  fileCount?: number;
  loc?: number;
};

export type EventStreamConfig = {
  apiBaseUrl: string;
  /** Path template; `:sessionId` and `:agentRunId` are substituted. */
  eventsPath: string;
  /** Path template for the run-update endpoint. */
  runUpdatePath: string;
  sessionId: string;
  agentRunId: string;
  /** Tag used in console error messages (e.g. "playground-runner"). */
  loggerTag?: string;
  fetchImpl?: typeof fetch;
};

export type EventStream = {
  postEvent(kind: AgentEventKind, payload?: Record<string, unknown>): Promise<void>;
  postRunUpdate(body: RunUpdateBody): Promise<void>;
};

export function createEventStream(config: EventStreamConfig): EventStream {
  const fetchImpl = config.fetchImpl ?? fetch;
  const tag = config.loggerTag ?? "event-stream";
  const eventsUrl = `${config.apiBaseUrl}${substitute(config.eventsPath, config)}`;
  const runUpdateUrl = `${config.apiBaseUrl}${substitute(config.runUpdatePath, config)}`;
  let seq = 0;

  return {
    async postEvent(kind, payload = {}) {
      const body: AppendEventBody = { agentRunId: config.agentRunId, seq: ++seq, kind, payload };
      try {
        const res = await fetchImpl(eventsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.error(`[${tag}] event POST failed (${res.status}): ${await res.text()}`);
        }
      } catch (err) {
        console.error(`[${tag}] event POST error:`, err);
      }
    },
    async postRunUpdate(body) {
      try {
        const res = await fetchImpl(runUpdateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.error(`[${tag}] run update failed (${res.status}): ${await res.text()}`);
        }
      } catch (err) {
        console.error(`[${tag}] run update error:`, err);
      }
    },
  };
}

function substitute(template: string, ctx: { sessionId: string; agentRunId: string }): string {
  return template.replace(":sessionId", ctx.sessionId).replace(":agentRunId", ctx.agentRunId);
}
