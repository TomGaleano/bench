import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeerSystemPrompt } from "./peer-prompt.js";

test("playground_agent prompt includes peer list, port, app URL", () => {
  const prompt = buildPeerSystemPrompt({
    role: "playground_agent",
    modelName: "openai/gpt-4o-mini",
    agentIndex: 0,
    totalAgents: 2,
    peers: ["anthropic/claude-haiku-4-5"],
    worktreePath: "/home/user/playground/agent-0",
    branch: "agent-0",
    assignedPort: 30000,
    appUrl: "https://example.e2b.dev",
  });
  assert.match(prompt, /agent 1 of 2/);
  assert.match(prompt, /Competing agents in this session: anthropic\/claude-haiku-4-5/);
  assert.match(prompt, /Your assigned port: 30000/);
  assert.match(prompt, /https:\/\/example\.e2b\.dev/);
  assert.match(prompt, /FINAL:/);
});

test("playground_agent prompt without peers says \"only agent\"", () => {
  const prompt = buildPeerSystemPrompt({
    role: "playground_agent",
    modelName: "openai/gpt-4o-mini",
    agentIndex: 0,
    totalAgents: 1,
    peers: [],
    worktreePath: "/home/user/playground/agent-0",
    branch: "agent-0",
  });
  assert.match(prompt, /You are the only agent in this session/);
  assert.doesNotMatch(prompt, /Your assigned port/);
});

test("test_builder prompt mentions output.json target path", () => {
  const prompt = buildPeerSystemPrompt({
    role: "test_builder",
    modelName: "openai/gpt-4o",
    agentIndex: 0,
    totalAgents: 1,
    peers: [],
    worktreePath: "/home/user/test-builder",
    branch: "test-builder",
    extra: "Gold patch:\n--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-pass\n+raise",
  });
  assert.match(prompt, /test-builder agent/);
  assert.match(prompt, /test-builder-output\.json/);
  assert.match(prompt, /failToPass/);
  assert.match(prompt, /Gold patch:/);
});

test("evaluator prompt mentions evaluator-output.json and rubric weights", () => {
  const prompt = buildPeerSystemPrompt({
    role: "evaluator",
    modelName: "anthropic/claude-opus-4-7",
    agentIndex: 0,
    totalAgents: 1,
    peers: [],
    worktreePath: "/home/user/evaluator",
    branch: "evaluator",
  });
  assert.match(prompt, /evaluator agent/);
  assert.match(prompt, /evaluator-output\.json/);
  assert.match(prompt, /40\/25\/15\/20/);
});

test("benchmark_agent prompt instructs commit + FINAL summary", () => {
  const prompt = buildPeerSystemPrompt({
    role: "benchmark_agent",
    modelName: "openai/gpt-4o",
    agentIndex: 1,
    totalAgents: 3,
    peers: ["m1", "m2"],
    worktreePath: "/home/user/bench/agent-1",
    branch: "agent-1",
  });
  assert.match(prompt, /competing on a SWE-bench-style coding task/);
  assert.match(prompt, /Commit your changes locally/);
  assert.match(prompt, /FINAL:/);
});

test("hasSeed adds SEED.md instruction", () => {
  const prompt = buildPeerSystemPrompt({
    role: "playground_agent",
    modelName: "m",
    agentIndex: 0,
    totalAgents: 1,
    peers: [],
    worktreePath: "/wt",
    branch: "b",
    hasSeed: true,
  });
  assert.match(prompt, /SEED\.md/);
});
