export type Model = {
  id: string;
  short: string;
  vendor: string;
  inputCost: number | null;
  outputCost: number | null;
};

export type Task = {
  id: string;
  repo: string;
  diff: "S" | "M" | "L";
  files: number;
  failTests: number;
  passTests: number;
  status: "ready" | "needs review";
};

export const models: Model[] = [
  { id: "qwen/qwen3.6-flash", short: "qwen3.6-flash", vendor: "OpenRouter candidate", inputCost: null, outputCost: null }
];

export const tasks: Task[] = [];

export const leaderboard: Array<{ model: string; harness: string; planScore: number; implementationScore: number; endToEndScore: number; costPerResolved: number }> = [];

export const activeExperiment = {
  active: 0,
  budget: 0,
  completed: 0,
  failed: 0,
  harness: "Not configured",
  models: [] as string[],
  name: "No active experiment",
  queued: 0,
  spend: 0,
  tasks: 0
};

export const runs: Array<{ id: string; model: string; task: string; status: string; stage: string; worker: string; progress: number }> = [];

export const replayEvents: Array<{ time: string; title: string; detail: string; status: string }> = [];

export const gradingRows: Array<{
  id: string;
  model: string;
  note: string;
  rubric: Array<{ label: string; value: number }>;
  score: number;
  status: string;
  task: string;
}> = [];
