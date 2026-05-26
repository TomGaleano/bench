import { shellQuote, type RuntimeWorkspace } from "./index.js";

export type AgentInbox = {
  appendFollowUp(text: string): Promise<void>;
  sendDone(): Promise<void>;
};

/**
 * Create an inbox that appends JSONL lines to `inboxPath` inside the sandbox.
 * The Pi agent script (see `sandbox-agent.ts`) tails this file for follow-ups.
 *
 * - `appendFollowUp(text)` writes `{ "text": "..." }`; the agent runs another turn.
 * - `sendDone()` writes `{ "done": true }`; the agent exits cleanly.
 */
export function createFollowUpInbox(input: {
  workspace: RuntimeWorkspace;
  inboxPath: string;
}): AgentInbox {
  const { workspace, inboxPath } = input;
  const append = async (line: string) => {
    const encoded = Buffer.from(line + "\n", "utf8").toString("base64");
    await workspace.run({
      command: `printf '%s' ${shellQuote(encoded)} | base64 -d >> ${shellQuote(inboxPath)}`,
      timeoutMs: 5_000,
    });
  };
  return {
    async appendFollowUp(text: string) {
      await append(JSON.stringify({ text }));
    },
    async sendDone() {
      await append(JSON.stringify({ done: true }));
    },
  };
}
