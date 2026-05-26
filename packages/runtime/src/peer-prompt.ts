export type PeerPromptRole =
  | "playground_agent"
  | "benchmark_agent"
  | "test_builder"
  | "evaluator";

export type PeerPromptInput = {
  role: PeerPromptRole;
  modelName: string;
  agentIndex: number;
  totalAgents: number;
  peers: string[];
  worktreePath: string;
  branch: string;
  assignedPort?: number;
  appUrl?: string;
  hasSeed?: boolean;
  /** Additional verbatim context (issue body, gold patch summary, etc.). */
  extra?: string;
};

export function buildPeerSystemPrompt(env: PeerPromptInput): string {
  const peerLine = env.peers.length > 0
    ? `Competing agents in this session: ${env.peers.join(", ")}.`
    : `You are the only agent in this session.`;
  const seedLine = env.hasSeed
    ? `\nThere is a SEED.md file in your working directory that contains starter context for this task. Read it first before doing anything else.\n`
    : "";

  const portLines = env.assignedPort != null && env.appUrl
    ? [
        `- Your assigned port: ${env.assignedPort}. If your task involves a web server, bind to **0.0.0.0:${env.assignedPort}** exclusively. Other agents have different ports.`,
        `- Your app's public URL when listening on that port: ${env.appUrl}`,
      ]
    : [];

  const lines: string[] = [
    `${roleHeading(env)} ${peerLine}`,
  ];
  if (seedLine) lines.push(seedLine);
  lines.push(
    `# Environment`,
    `You are running inside a shared E2B Linux sandbox.`,
    ``,
    `- Your working directory: ${env.worktreePath} (git branch \`${env.branch}\`)`,
    `- Only read, write, edit, or \`cd\` inside this directory. Do NOT touch any path outside it — those belong to other agents.`,
    ...portLines,
    ``,
    `# Tools`,
    `You have tools to read, write, and edit files, and to run bash commands. Stay inside ${env.worktreePath}.`,
    ``,
  );
  if (env.extra && env.extra.trim().length > 0) {
    lines.push(`# Task context`, env.extra, ``);
  }
  lines.push(`# Goals`, ...roleGoals(env));
  return lines.join("\n");
}

function roleHeading(env: PeerPromptInput): string {
  const which = `${env.agentIndex + 1} of ${env.totalAgents} (${env.modelName})`;
  switch (env.role) {
    case "playground_agent":
      return `You are agent ${which} in a head-to-head playground session.`;
    case "benchmark_agent":
      return `You are agent ${which} competing on a SWE-bench-style coding task.`;
    case "test_builder":
      return `You are a test-builder agent (${env.modelName}) for a SWE-bench-style case. Your job is to propose fail-to-pass / pass-to-pass tests.`;
    case "evaluator":
      return `You are an evaluator agent (${env.modelName}). Your job is to score competing agents' solutions against the gold patch.`;
  }
}

function roleGoals(env: PeerPromptInput): string[] {
  const port = env.assignedPort;
  const url = env.appUrl;
  switch (env.role) {
    case "playground_agent": {
      const goals: string[] = [
        `- Build a complete, working application that satisfies the user's prompt.`,
        `- Prefer a small set of files in a single directory. Use whatever stack fits the task.`,
      ];
      if (port != null && url) {
        goals.push(
          `- If you start a web server, bind to **0.0.0.0:${port}** and leave it running so the human grader can open ${url}.`,
          `- Start the server in the background (e.g. \`nohup python3 app.py > server.log 2>&1 &\`), then **verify it is actually listening** with \`curl -fsS http://127.0.0.1:${port}/ -o /dev/null && echo LISTENING\` before writing your FINAL message. If curl fails, fix the server first.`,
        );
      }
      goals.push(
        `- When you are done, write a final message starting with **"FINAL:"** that summarizes what you built, how to run it${url ? `, and includes the public URL ${url}` : ""}.`,
      );
      return goals;
    }
    case "benchmark_agent":
      return [
        `- Read the issue (provided in your task prompt) and the codebase, then implement a fix on this branch.`,
        `- Commit your changes locally so a diff against the base commit captures your work.`,
        `- When done, write a final message starting with **"FINAL:"** that summarizes the change and lists the modified files.`,
      ];
    case "test_builder":
      return [
        `- Inspect the codebase at the base commit and the gold patch (diff between base and gold) provided in your task context.`,
        `- Propose fail-to-pass tests that fail on the base commit and pass on the gold commit, and pass-to-pass tests that pass on both.`,
        `- Run candidate tests in this sandbox to verify the fail/pass semantics before declaring them done.`,
        `- Write the final tests to \`${env.worktreePath}/test-builder-output.json\` as \`{ failToPass: TestSpec[], passToPass: TestSpec[] }\`. Each TestSpec is \`{ filePath, testCommand, content, rationale }\`. Aim for the smallest set that exercises the change.`,
        `- When done, write a final message starting with **"FINAL:"** that explains how each test exercises the bug fix.`,
      ];
    case "evaluator":
      return [
        `- Read the gold patch (provided as \`gold.patch\` in your task context) and each competing agent's worktree under sibling directories of this one.`,
        `- Score each agent on the four-axis rubric: correctness, codeQuality, ux, shipIt — each 1–5. Compute overall (0–100) using weights 40/25/15/20.`,
        `- Write the scores to \`${env.worktreePath}/evaluator-output.json\` as \`{ scores: [{ agentIndex, branch, overall, correctness, codeQuality, ux, shipIt, rationale }] }\`.`,
        `- When done, write a final message starting with **"FINAL:"** that lists each agent's overall score and the rationale.`,
      ];
  }
}
