Below is a build-ready product/architecture brief for a coding-agent benchmarking app that separates **planning quality** from **implementation quality**, uses **Pi as the standardized coding-agent harness**, and supports **live streaming, parallel runs, durable sessions, historical leaderboards, and price-to-performance tracking**.

Small correction to anchor the benchmark: SWE-bench-style implementation scoring should not primarily compare the submitted patch to the gold diff. SWE-bench’s primary signal is whether the agent’s patch makes the previously failing tests pass while preserving passing tests; the gold patch/diff is best used for planning coverage, diagnosis, and optional secondary similarity metrics. SWE-bench describes each task as a real GitHub issue, base repo state, and fail-to-pass tests that fail before the PR and pass after it. ([SWE-bench][1])

---

## 1. Product goal

Build a benchmark platform that can answer questions like:

“Is a lower-cost model bad at planning, implementation, or both?”

“Can an expensive frontier planner plus a cheap implementer beat a single expensive end-to-end agent on cost?”

“Which model gives the best resolved-tasks-per-dollar over time?”

The core benchmark should run the same task through three modes:

| Mode                    |                               What it measures | Input to agent                     | Output             | Scoring                                 |
| ----------------------- | ---------------------------------------------: | ---------------------------------- | ------------------ | --------------------------------------- |
| **Plan-only**           |           Planning/localization/design ability | Issue + base repo                  | Structured plan    | Judge compares plan to gold patch atoms |
| **Implementation-only** | Coding/execution ability under controlled plan | Issue + reference plan + base repo | Patch              | SWE-bench-style tests                   |
| **End-to-end**          |                  Real coding-agent performance | Issue + base repo                  | Patch + trajectory | SWE-bench-style tests + trace metrics   |

This lets you build a matrix:

| Planner        | Implementer    | What it tells you                         |
| -------------- | -------------- | ----------------------------------------- |
| Model A        | Model A        | true end-to-end baseline                  |
| Frontier model | Model A        | how well Model A implements a strong plan |
| Model A        | Frontier model | whether Model A can produce useful plans  |
| Frontier model | cheap model    | price/performance strategy                |

---

## 2. Existing foundations to reuse

### SWE-bench data model

Use SWE-bench fields as your canonical task schema: `instance_id`, `repo`, `issue_id`, `base_commit`, `problem_statement`, `issue_url`, `pr_url`, `patch`, `test_patch`, `FAIL_TO_PASS`, and `PASS_TO_PASS`. Their docs show this exact task structure, including `patch`, `test_patch`, and test sets. ([SWE-bench][2])

SWE-bench’s own harness is Docker-based, and the official README shows evaluation through `python -m swebench.harness.run_evaluation` with `dataset_name`, `predictions_path`, `max_workers`, and `run_id`. ([GitHub][3]) SWE-bench Pro also uses Docker/Modal and exposes Docker image tags per instance, which is useful for your own “Pro-like” task execution model. ([GitHub][4])

### Pi as the standardized agent

Pi is a good fit because it is a minimal terminal coding harness with built-in tools like `read`, `write`, `edit`, and `bash`, and it supports provider/model selection across many APIs. ([GitHub][5]) It also supports multiple modes: interactive, print/JSON, RPC over stdio, and SDK embedding, which maps well to a benchmark runner. ([GitHub][5])

Important constraint: Pi’s README says it intentionally skips built-in plan mode, so your app should add planning as a benchmark wrapper: custom prompt, restricted tools, structured output, and write-blocking for plan-only runs. ([GitHub][5]) Pi sessions are stored as JSONL files with branching, which you can preserve as raw artifacts while also normalizing events into your own database. ([DeepWiki][6])

---

## 3. Recommended high-level architecture

```text
                       ┌──────────────────────────────┐
                       │          Web App             │
                       │ leaderboard / live runs / UI │
                       └──────────────┬───────────────┘
                                      │ WS/SSE + REST
                                      ▼
┌────────────────────────────────────────────────────────────────┐
│                       API + Stream Gateway                     │
│  auth, experiments, models, tasks, event fanout, run snapshots  │
└──────────────┬──────────────────────────────┬──────────────────┘
               │                              │
               ▼                              ▼
     ┌──────────────────┐           ┌────────────────────┐
     │ Workflow Engine  │           │ Postgres + Object  │
     │ Temporal/BullMQ  │           │ Storage + Redis    │
     └───────┬──────────┘           └────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────┐
│                         Worker Pool                            │
│                                                                │
│  Pi Runner Worker     Judge Worker       SWE-bench Eval Worker │
│  - plan runs          - plan scoring     - patch evaluation    │
│  - impl runs          - diff atomizer    - Docker/Modal jobs   │
│  - event capture      - adjudication     - logs/results        │
└─────────────┬──────────────────────────────┬───────────────────┘
              │                              │
              ▼                              ▼
       ┌─────────────┐                ┌──────────────┐
       │ Git cache + │                │ Sandboxed     │
       │ workspaces  │                │ containers    │
       └─────────────┘                └──────────────┘
```

Use a monorepo:

```text
apps/
  web/                         # Next.js frontend
  api/                         # Fastify/NestJS API + WebSocket/SSE gateway
workers/
  pi-runner/                   # TypeScript worker wrapping Pi RPC/SDK
  judge/                       # plan atomization + LLM judging
  evaluator/                   # Python SWE-bench harness runner
packages/
  db/                          # Prisma/Drizzle schema + migrations
  shared/                      # shared TS types, Zod schemas
  benchmark-spec/              # task schema, scoring schema, prompt versions
infra/
  docker/
  compose.yaml
  k8s/
```

---

## 4. Suggested technology stack

For an MVP:

| Layer         | Recommendation                                                   | Why                                                              |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Frontend      | **Next.js + TypeScript + Tailwind + shadcn/ui**                  | Fast design iteration, good dashboards                           |
| Live views    | **WebSocket for multiplexed run streams**, SSE for simple logs   | You need parallel run panes                                      |
| API           | **Node.js/TypeScript + Fastify or NestJS**                       | Pi is TypeScript-native and exposes RPC/SDK paths                |
| DB            | **Postgres**                                                     | Durable run/session/task/model data                              |
| ORM           | **Prisma or Drizzle**                                            | Type-safe schema                                                 |
| Queue         | **BullMQ + Redis** for MVP; **Temporal** for production          | BullMQ is quick; Temporal is better for long resumable workflows |
| Artifacts     | **S3/MinIO**                                                     | Store patches, Pi JSONL logs, full stdout, diffs                 |
| Eval worker   | **Python worker using SWE-bench harness**                        | Avoid reimplementing SWE-bench execution                         |
| Sandbox       | **Docker locally; Kubernetes Jobs or Modal-style runners later** | Reproducible, parallel, isolated                                 |
| Observability | **OpenTelemetry + Prometheus/Grafana**                           | Long-running jobs need traceability                              |

For production, I would choose **Temporal** over a simple queue. Agent runs can be long, flaky, retried, cancelled, resumed, and audited. Temporal gives you durable workflows like:

```text
RunBenchmarkTaskWorkflow
  ├─ PrepareWorkspaceActivity
  ├─ RunPlanningAgentActivity
  ├─ ScorePlanActivity
  ├─ RunImplementationAgentActivity
  ├─ EvaluatePatchActivity
  └─ AggregateResultsActivity
```

---

## 5. Core backend concepts

### Benchmark task

A task is immutable once published into a benchmark version.

```ts
type BenchmarkTask = {
  id: string;
  benchmarkId: string;
  instanceId: string;          // e.g. "sqlfluff__sqlfluff-2419"
  repo: string;                // "sqlfluff/sqlfluff"
  issueId: number;
  prId: number;
  issueUrl: string;
  prUrl: string;
  baseCommit: string;
  environmentSetupCommit?: string;
  problemStatement: string;
  hintsText?: string;

  goldPatchRef: string;        // object storage key
  testPatchRef: string;        // object storage key
  failToPass: string[];
  passToPass: string[];

  language: string;
  difficulty?: "easy" | "medium" | "hard";
  createdAtSource: string;
};
```

### Model registry

Store both provider identity and historical pricing snapshots.

```ts
type ModelVersion = {
  id: string;
  provider: "openai" | "anthropic" | "deepseek" | "qwen" | "zai" | "kimi" | "openrouter" | string;
  providerModelId: string;
  displayName: string;
  releaseDate?: string;
  contextWindow?: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  active: boolean;
};

type PricingSnapshot = {
  id: string;
  modelVersionId: string;
  effectiveAt: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  reasoningUsdPer1M?: number;
  sourceUrl?: string;
};
```

Never mutate old prices. A historical leaderboard should show:

1. **cost at run time**
2. **cost under current pricing**
3. **score per dollar at run time**
4. **score per dollar under current pricing**

### Agent configuration

```ts
type AgentConfig = {
  id: string;
  name: string;
  harness: "pi";
  piVersion: string;
  systemPromptVersion: string;
  mode: "plan" | "implement" | "end_to_end";
  toolPolicyId: string;
  maxTurns: number;
  maxWallClockSeconds: number;
  maxCostUsd?: number;
  temperature: number;
  modelVersionId: string;
};
```

### Run event

Everything visible in the UI should be an append-only event.

```ts
type RunEvent = {
  id: string;
  runId: string;
  seq: number;
  ts: string;
  stage: "prepare" | "plan" | "judge" | "implement" | "evaluate" | "aggregate";
  kind:
    | "status"
    | "assistant_text_delta"
    | "tool_call_started"
    | "tool_call_delta"
    | "tool_call_finished"
    | "file_changed"
    | "patch_created"
    | "test_started"
    | "test_finished"
    | "cost_update"
    | "error"
    | "score_update";
  payload: unknown;
};
```

Store all events in Postgres or object storage-backed JSONL, then fan out live events through Redis Pub/Sub, NATS, or a WebSocket gateway.

---

## 6. Pi runner design

### Use Pi RPC/SDK rather than scraping terminal output

Pi has RPC/JSON and SDK embedding modes, which are better for benchmark automation than driving a terminal UI. ([DeepWiki][6]) The runner should:

1. Create an isolated workspace at the task’s `base_commit`.

2. Create a run-specific Pi home directory, for example:

   ```text
   /runs/{run_id}/pi-home/
   /runs/{run_id}/workspace/
   /runs/{run_id}/artifacts/
   ```

3. Inject benchmark-specific `.pi/` config:

   ```text
   .pi/
     SYSTEM.md
     prompts/
       benchmark-plan.md
       benchmark-implement.md
     settings.json
   ```

4. Launch Pi in RPC/JSON mode.

5. Convert Pi events into your normalized `RunEvent` format.

6. Persist Pi’s raw session JSONL as an artifact.

7. Extract final `plan.json`, `plan.md`, or `git diff`.

### Tool policies

You need different tool restrictions per stage.

**Planning stage**

Allowed:

```text
read
grep/search
ls/tree
safe bash commands: rg, find, sed, cat, python -m pytest --collect-only
```

Blocked:

```text
write
edit
git apply
network
package publishing
destructive shell commands
```

The planning workspace can be mounted read-only, but some repo tooling writes caches. A better pattern is a writable workspace plus a post-run assertion that `git diff` is empty. If Pi cannot natively restrict tools enough, write a small Pi extension that wraps or disables `write`, `edit`, and dangerous `bash` commands.

**Implementation stage**

Allowed:

```text
read
write
edit
bash
test commands
git diff
```

Still blocked:

```text
network access from tool sandbox
secrets
host filesystem
Docker socket
privileged containers
```

### Security model

Do not put model-provider API keys inside the same container where untrusted repo tests execute. A malicious test could print env vars or exfiltrate them if network is enabled.

Safer production architecture:

```text
Pi/LLM process with provider access
        │
        │ tool request
        ▼
Tool proxy
        │
        │ executes command
        ▼
Sandbox container with no provider keys and restricted network
```

For an MVP on trusted tasks, you can run Pi and tools in the same locked-down runner, but production should separate LLM credentials from repository code execution.

---

## 7. Benchmark execution flow

### A. Planning run

Input to agent:

```text
You are planning a fix for this GitHub issue.
You may inspect the repository, but you must not modify files.
Return a structured plan with:
- suspected root cause
- files/functions to inspect or change
- exact behavioral changes
- tests to add or update
- risks / edge cases
```

Output format:

```json
{
  "root_cause": "...",
  "change_plan": [
    {
      "file": "src/sqlfluff/rules/L060.py",
      "symbol": "Rule_L060._eval",
      "change": "Customize violation message based on the detected function name.",
      "reason": "The current message mentions both IFNULL and NVL even when only one is present."
    }
  ],
  "tests": [
    {
      "file": "test/rules/std_L060_test.py",
      "case": "Assert IFNULL reports IFNULL-specific message and NVL reports NVL-specific message."
    }
  ],
  "risks": ["Do not change rule behavior, only the message/fix metadata."]
}
```

### B. Planning score

Do not ask the judge to compare free-form plan directly to raw diff only. First convert the gold patch into “gold edit atoms.”

Example atom:

```json
{
  "atom_id": "sqlfluff-2419-1",
  "file": "src/sqlfluff/rules/L060.py",
  "symbol": "Rule_L060._eval",
  "behavior": "Generate a violation description that names the specific offending function, IFNULL or NVL, rather than listing both.",
  "required": true,
  "weight": 0.7
}
```

Then judge the plan against atoms.

Recommended planning score:

```text
planning_score =
  0.60 * semantic_gold_atom_coverage
+ 0.15 * file_and_symbol_localization
+ 0.10 * test_strategy_coverage
+ 0.10 * implementation_specificity
+ 0.05 * risk_awareness
- penalties
```

Penalties:

```text
-0.10 hallucinated nonexistent APIs
-0.10 proposes broad rewrite when small fix is enough
-0.20 misses core failing behavior
-0.30 plan would likely break public API
```

Use at least two judge calls for important runs:

```text
judge_1 score
judge_2 score
adjudicator if abs(score_1 - score_2) > threshold
```

Store judge rationales, but make leaderboard sortable by numeric score.

### C. Implementation run

Input to agent:

```text
You are implementing a fix for this issue.
Follow the provided plan.
Modify the repository.
Run relevant tests.
Return only when the patch is ready.
```

The reference plan should come from either:

1. a manually curated gold plan,
2. the strongest planner model for that benchmark version,
3. a consensus plan synthesized from multiple strong planners.

This isolates implementation ability. A cheaper model that scores poorly end-to-end but well with a strong plan may be a good “implementation worker.”

### D. SWE-bench-style evaluation

After Pi finishes:

1. Capture `git diff`.
2. Build prediction JSONL:

   ```json
   {
     "instance_id": "sqlfluff__sqlfluff-2419",
     "model_name_or_path": "provider/model",
     "model_patch": "diff --git ..."
   }
   ```
3. Run the SWE-bench harness or your compatible evaluator.
4. Store:

   ```text
   resolved: boolean
   fail_to_pass_passed: number
   fail_to_pass_total: number
   pass_to_pass_passed: number
   pass_to_pass_total: number
   logs
   patch_apply_status
   timeout_status
   ```

Primary implementation metric:

```text
resolved = all FAIL_TO_PASS tests pass AND required PASS_TO_PASS tests still pass
```

Secondary metrics:

```text
partial_test_score = 0.7 * F2P_rate + 0.3 * P2P_rate
patch_size
files_touched
time_to_first_edit
test_iterations
tool_call_count
cost_usd
```

---

## 8. Initial seed benchmark: 5 issue/PR tasks

For first testing, use SWE-bench Lite-style tasks because they already include base commits, gold patches, test patches, and fail/pass test lists. The SWE-bench Lite dataset preview shows exactly these fields for visible rows such as SQLFluff, marshmallow, pvlib, PyVista, and pydicom. ([Hugging Face][7])

| Instance                             | Repo                           | Issue |    PR | Base commit                                | Why it is useful                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------ | ----: | ----: | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sqlfluff__sqlfluff-2419`            | `sqlfluff/sqlfluff`            | #2415 | #2419 | `f1dba0e1dd764ae72d67c3d5e1471cf14d3db030` | Small rule-message change. Great for testing planning localization and minimal implementation. Issue asks L060 to mention the specific offending function rather than both `IFNULL` and `NVL`; PR #2419 closes it. ([GitHub][8]) |
| `marshmallow-code__marshmallow-1359` | `marshmallow-code/marshmallow` | #1357 | #1359 | `b40a0f4e33823e6d0f341f7e8684e359a99060d1` | Good nested schema/field binding bug. Issue reports `DateTime` failing inside `List`/`Tuple`; PR #1359 fixes #1357. ([GitHub][9])                                                                                                |
| `pvlib__pvlib-python-1707`           | `pvlib/pvlib-python`           | #1706 | #1707 | `40e9e978c170bdde4eeee1547729417665dbc34c` | Numeric edge-case bug. Issue reports `iam.physical(aoi=100, n=1)` returning `nan` instead of `0`; PR #1707 closes it. ([GitHub][10])                                                                                             |
| `pyvista__pyvista-4315`              | `pyvista/pyvista`              | #4304 | #4315 | `db6ee8dd4a747b8864caae36c5d05883976a3ae5` | API input-type bug. Issue says `RectilinearGrid` errors on Python sequences but works on arrays; PR #4315 allows sequences. ([GitHub][11])                                                                                       |
| `pydicom__pydicom-1694`              | `pydicom/pydicom`              | #1693 | #1694 | `f8cf45b6c121e5a4bf4a43f71aba3bc64af3db9c` | Error-handling bug. Issue says `to_json_dict(suppress_invalid_tags=True)` can still throw; PR #1694 moves handling around failed `DataElement` creation. ([GitHub][12])                                                          |

Seed benchmark YAML:

```yaml
benchmark:
  id: coding-agent-bench-v0.1
  name: Planning vs Implementation Seed Benchmark
  source: SWE-bench Lite compatible
  tasks:
    - instance_id: sqlfluff__sqlfluff-2419
      repo: sqlfluff/sqlfluff
      issue_id: 2415
      pr_id: 2419
      base_commit: f1dba0e1dd764ae72d67c3d5e1471cf14d3db030

    - instance_id: marshmallow-code__marshmallow-1359
      repo: marshmallow-code/marshmallow
      issue_id: 1357
      pr_id: 1359
      base_commit: b40a0f4e33823e6d0f341f7e8684e359a99060d1

    - instance_id: pvlib__pvlib-python-1707
      repo: pvlib/pvlib-python
      issue_id: 1706
      pr_id: 1707
      base_commit: 40e9e978c170bdde4eeee1547729417665dbc34c

    - instance_id: pyvista__pyvista-4315
      repo: pyvista/pyvista
      issue_id: 4304
      pr_id: 4315
      base_commit: db6ee8dd4a747b8864caae36c5d05883976a3ae5

    - instance_id: pydicom__pydicom-1694
      repo: pydicom/pydicom
      issue_id: 1693
      pr_id: 1694
      base_commit: f8cf45b6c121e5a4bf4a43f71aba3bc64af3db9c
```

---

## 9. Database schema sketch

Core tables:

```sql
benchmarks
  id, name, version, description, created_at, frozen_at

benchmark_tasks
  id, benchmark_id, instance_id, repo, issue_id, pr_id,
  base_commit, environment_setup_commit,
  problem_statement, hints_text, created_at_source,
  fail_to_pass jsonb, pass_to_pass jsonb,
  gold_patch_artifact_id, test_patch_artifact_id,
  metadata jsonb

model_versions
  id, provider, provider_model_id, display_name,
  context_window, supports_tools, supports_streaming,
  created_at, deprecated_at

pricing_snapshots
  id, model_version_id, effective_at,
  input_usd_per_1m, output_usd_per_1m,
  cached_input_usd_per_1m, reasoning_usd_per_1m,
  source_url

agent_configs
  id, name, harness, harness_version, model_version_id,
  mode, prompt_version, tool_policy_id,
  temperature, max_turns, max_wall_clock_seconds, max_cost_usd

experiments
  id, benchmark_id, name, description,
  created_by, created_at, status

run_groups
  id, experiment_id, task_id, planner_config_id,
  implementer_config_id, mode, status

runs
  id, run_group_id, stage, agent_config_id,
  status, started_at, finished_at,
  cost_usd, input_tokens, output_tokens, cached_tokens,
  wall_clock_seconds, error_message

run_events
  id, run_id, seq, ts, stage, kind, payload jsonb

plans
  id, run_id, task_id, artifact_id,
  structured_plan jsonb, markdown text

gold_edit_atoms
  id, task_id, file_path, symbol, behavior,
  weight, atom_json jsonb

plan_scores
  id, plan_id, judge_model_version_id,
  score_total, coverage_score, localization_score,
  test_score, specificity_score, risk_score,
  rationale, raw_json jsonb

patches
  id, run_id, task_id, diff_artifact_id,
  files_touched int, lines_added int, lines_removed int

evaluations
  id, patch_id, task_id, resolved boolean,
  fail_to_pass_passed int, fail_to_pass_total int,
  pass_to_pass_passed int, pass_to_pass_total int,
  logs_artifact_id, raw_result jsonb
```

Artifact table:

```sql
artifacts
  id, kind, storage_url, sha256, size_bytes,
  content_type, created_at
```

Useful artifact kinds:

```text
gold_patch
test_patch
predicted_patch
pi_session_jsonl
workspace_tarball
eval_log
stdout_log
stderr_log
plan_markdown
plan_json
judge_raw_response
```

---

## 10. Streaming model

The UI should feel like watching multiple agents run side-by-side.

### Backend

Each worker writes events to an append-only stream:

```text
run:{run_id}:events
```

The API gateway exposes:

```http
GET /api/experiments/:id
GET /api/experiments/:id/runs
GET /api/runs/:runId/events?afterSeq=123
GET /api/runs/:runId/artifacts
WS  /api/stream?experimentId=...
```

WebSocket message:

```json
{
  "type": "run_event",
  "experiment_id": "exp_123",
  "run_id": "run_456",
  "seq": 42,
  "stage": "implement",
  "kind": "tool_call_started",
  "payload": {
    "tool": "bash",
    "command": "pytest tests/test_fields.py::TestParentAndName::test_datetime_list_inner_format"
  }
}
```

### Frontend

The frontend subscribes once per experiment and multiplexes events by `run_id`.

Run cards should update live:

```text
Model: qwen/example
Stage: implementation
Status: running
Latest: bash pytest ...
Cost: $0.018
Tokens: 31.2k in / 4.8k out
Tool calls: 17
Patch: 2 files changed
```

---

## 11. Price-to-performance metrics

Store raw metrics first, then compute leaderboard views.

Planning:

```text
plan_score_0_100
plan_score_per_dollar = plan_score_0_100 / max(cost_usd, 0.001)
plan_score_per_minute = plan_score_0_100 / wall_clock_minutes
```

Implementation:

```text
resolved_rate = resolved_tasks / total_tasks
cost_per_resolved = total_cost_usd / max(resolved_tasks, 1)
resolved_per_dollar = resolved_tasks / total_cost_usd
```

Combined:

```text
overall_score =
  0.35 * normalized_planning_score
+ 0.65 * resolved_rate
```

For small benchmark sizes, always show uncertainty:

```text
resolved_rate with Wilson interval
bootstrap confidence interval for cost_per_resolved
per-task breakdown
```

For historical tracking, leaderboard rows should be keyed by:

```text
benchmark_version
task_set_hash
agent_config_hash
model_version_id
pricing_snapshot_id
run_date
```

This prevents leaderboard drift when prompts, Pi versions, prices, or task sets change.

---

## 12. MVP workflow

### Milestone 1: Task ingestion

Build:

```text
POST /api/tasks/import-swebench-lite
POST /api/benchmarks
POST /api/benchmarks/:id/tasks
```

Importer should support:

```text
from Hugging Face SWE-bench rows
from manual issue_url + pr_url
from local JSON/YAML
```

For manual GitHub import:

1. Fetch issue title/body/comments.
2. Fetch PR metadata.
3. Fetch PR base commit.
4. Fetch PR diff.
5. Split test files from non-test files.
6. Validate by running:

   * base commit: fail-to-pass tests fail
   * after PR patch: fail-to-pass tests pass
7. Freeze task artifact.

### Milestone 2: Pi planning runner

Build one run type:

```text
task + model + plan prompt -> plan.json + event stream
```

No scoring yet. Focus on:

```text
Pi RPC integration
streaming tokens/tool calls
persistent session artifacts
parallel runs
```

### Milestone 3: Plan judge

Build:

```text
gold patch -> edit atoms
plan + atoms -> score
```

Start with LLM-generated atoms but store them so they can be manually corrected later.

### Milestone 4: Implementation runner + evaluator

Build:

```text
task + reference plan + model -> predicted patch -> SWE-bench evaluation
```

Use Docker locally first. Add Kubernetes/Modal later.

### Milestone 5: Leaderboards

Views:

```text
planning leaderboard
implementation leaderboard
end-to-end leaderboard
cost/performance scatter
historical trend by model
per-task matrix
```

---

## 13. Frontend brief for a design agent

Design this as a **benchmark lab console**, not a marketing dashboard.

### Information architecture

Primary navigation:

```text
Dashboard
Benchmarks
Experiments
Runs
Models
Tasks
Artifacts
Settings
```

### Page 1: Dashboard / leaderboard

Purpose: compare models quickly.

Sections:

```text
Top summary cards:
- best planning score
- best implementation resolved rate
- best cost/resolved
- fastest median run

Charts:
- score vs cost scatter with Pareto frontier
- planning score vs implementation score matrix
- historical score trend by model

Table:
- model
- harness config
- planning score
- implementation resolved %
- end-to-end resolved %
- cost/task
- cost/resolved
- median latency
- benchmark version
```

### Page 2: Experiment setup wizard

Steps:

```text
1. Select benchmark version
2. Select tasks or stratified sample
3. Select planner models
4. Select implementer models
5. Select run modes: plan-only, implementation-only, end-to-end
6. Set limits: max cost, max turns, max runtime, retries
7. Launch
```

### Page 3: Live parallel run monitor

This is the signature product surface.

Layout:

```text
Top: experiment status, progress bar, total cost, ETA-like progress without promising completion
Left: filters by model/task/stage/status
Main: grid of run cards
Right: selected run detail drawer
Bottom: event timeline / logs
```

Run card states:

```text
queued
preparing
planning
judging
implementing
evaluating
resolved
failed
timeout
cancelled
```

Each run card:

```text
Model name
Task id
Stage
Live text stream preview
Current tool call
Cost/tokens
Duration
Patch files touched
Test status
```

### Page 4: Run detail / replay

Split-pane view:

```text
Left: event timeline
Center: chat/session replay with text + tool calls
Right: artifacts
  - final plan
  - diff
  - test results
  - judge score
  - raw Pi session
```

Key interactions:

```text
scrub through timeline
collapse tool output
filter to file changes only
show cost accumulation over time
download patch
open exact test failure
```

### Page 5: Planning score detail

Purpose: make judge scores auditable.

Layout:

```text
Left: agent plan
Center: gold edit atoms
Right: score rubric
Bottom: judge rationale
```

Gold atom row:

```text
Atom: "Update DateTime bind logic to resolve format from root schema"
Covered: yes / partial / no
Evidence from plan: highlighted excerpt
Weight: 0.35
Judge comment
```

### Page 6: Task detail

Layout:

```text
Issue prompt
Repo/base commit
PR metadata
Gold patch hidden by default
Test patch hidden by default
FAIL_TO_PASS tests
PASS_TO_PASS tests
Historical model outcomes on this task
```

Use “hidden by default” for gold artifacts to avoid accidental leakage during manual review.

### Visual style

Direction:

```text
Dense, technical, high-signal.
Dark-mode first.
Monospace for traces/diffs.
Status colors used sparingly.
Avoid playful visuals.
```

Suggested components:

```text
RunLane
RunCard
TokenCostMeter
ToolCallPill
PatchSummary
DiffViewer
PlanCoverageHeatmap
TestResultBadge
ModelComparisonTable
ParetoScatterplot
SessionReplay
ArtifactDrawer
```

---

## 14. Coding-agent handoff prompt

You can give this directly to a coding agent:

```text
Build an MVP of a coding-agent benchmark platform.

Use a monorepo with:
- apps/web: Next.js + TypeScript frontend
- apps/api: Fastify or NestJS API
- workers/pi-runner: TypeScript worker that runs Pi in RPC/JSON mode
- workers/evaluator: Python worker that can call the SWE-bench harness later
- packages/db: Postgres schema using Prisma or Drizzle
- packages/shared: shared Zod schemas and TypeScript types

Core MVP requirements:
1. Create benchmark/task/model/experiment/run tables.
2. Import five seed tasks from a YAML file.
3. Start an experiment with N tasks x M model configs.
4. Create run records and stream mock or real Pi events over WebSocket.
5. Implement a Pi runner interface:
   - prepare workspace
   - run planning prompt
   - capture text/tool events
   - persist raw session JSONL artifact
   - produce plan.json
6. Implement the event schema:
   - status
   - assistant_text_delta
   - tool_call_started
   - tool_call_delta
   - tool_call_finished
   - cost_update
   - error
   - score_update
7. Build frontend pages:
   - leaderboard
   - experiment setup
   - live parallel run monitor
   - run detail replay
   - task detail
8. Keep all scoring pluggable. Add placeholder judge and evaluator workers first.
9. Design for append-only run events and immutable benchmark versions.
10. Do not expose provider API keys to sandboxed repo code.
```

---

## 15. Key design decisions I would lock in early

1. **Use SWE-bench task schema as your internal canonical format.** It prevents you from inventing an incompatible benchmark format.

2. **Separate plan-only, implementation-only, and end-to-end modes.** This is the core product insight.

3. **Use Pi RPC/SDK integration, not terminal scraping.** You need structured streaming and durable sessions.

4. **Make run events append-only.** This gives you live streaming, replay, auditability, and debugging from one abstraction.

5. **Store raw artifacts and normalized summaries.** Raw Pi JSONL, raw logs, raw patches, and raw judge outputs should never be discarded.

6. **Keep gold patches hidden from agents.** Gold patch is for plan scoring and analysis only.

7. **Use tests as implementation ground truth.** Diff similarity is useful for diagnosis but should not be the main implementation score.

8. **Version everything.** Benchmark version, task set, prompt, Pi version, model version, provider pricing, judge model, evaluator image, and tool policy all affect results.

9. **Optimize for cross-model matrices.** The most interesting product view will be “expensive planner + cheap implementer” versus “cheap planner + cheap implementer” versus “frontier end-to-end.”

10. **Design the UI around live comparison.** The user should be able to watch 20 agents attack the same task in parallel and immediately understand who is stuck, who is editing, who is testing, and who is burning money.

[1]: https://www.swebench.com/original.html "SWE-bench"
[2]: https://www.swebench.com/SWE-bench/guides/datasets/ "Datasets - SWE-bench"
[3]: https://github.com/swe-bench/SWE-bench "GitHub - SWE-bench/SWE-bench: SWE-bench: Can Language Models Resolve Real-world Github Issues? · GitHub"
[4]: https://github.com/scaleapi/SWE-bench_Pro-os "GitHub - scaleapi/SWE-bench_Pro-os: SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks? · GitHub"
[5]: https://github.com/davidondrej/pi-agent/blob/main/packages/coding-agent "pi-agent/packages/coding-agent at main · davidondrej/pi-agent · GitHub"
[6]: https://deepwiki.com/badlogic/pi-mono/4-pi-coding-agent%3A-coding-agent-cli "pi-coding-agent: Coding Agent CLI | badlogic/pi-mono | DeepWiki"
[7]: https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite "SWE-bench/SWE-bench_Lite · Datasets at Hugging Face"
[8]: https://github.com/sqlfluff/sqlfluff/issues/2415 "Rule L060 could give a specific error message · Issue #2415 · sqlfluff/sqlfluff · GitHub"
[9]: https://github.com/marshmallow-code/marshmallow/issues/1357 "3.0: DateTime fields cannot be used as inner field for List or Tuple fields · Issue #1357 · marshmallow-code/marshmallow · GitHub"
[10]: https://github.com/pvlib/pvlib-python/issues/1706 "regression: iam.physical returns nan for aoi > 90° when n = 1 · Issue #1706 · pvlib/pvlib-python · GitHub"
[11]: https://github.com/pyvista/pyvista/issues/4304 "Rectilinear grid does not allow Sequences as inputs · Issue #4304 · pyvista/pyvista · GitHub"
[12]: https://github.com/pydicom/pydicom/issues/1693 "Dataset.to_json_dict can still generate exceptions when suppress_invalid_tags=True · Issue #1693 · pydicom/pydicom · GitHub"
