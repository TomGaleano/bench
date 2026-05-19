# SWE-bench Test Generation & Validation Research

**Date:** 2026-05-05
**Researcher:** Web subagent (deep research)
**Context:** Informing Pi Lab's validation pipeline design

---

## Key Finding: SWE-bench Tests Are EXTRACTED, Not Generated

This is the most important insight for our platform:

**SWE-bench does NOT use LLMs to generate tests.** Instead, it:

1. Scrapes real merged PRs from GitHub
2. Extracts the `test_patch` (the diff of test files from the PR)
3. Pre-computes test results at base and gold commits
4. Categorizes tests based on their `(base_status, gold_status)` transitions

The "oracle" is purely execution-based: run the actual test suite at two commits and observe pass/fail transitions.

### Implications for Pi Lab

Our current approach of using a Pi coding agent to generate tests from scratch is **fundamentally different** from how SWE-bench works. We're trying to do something harder: infer test intent from issue descriptions without the human-written test patch.

**Recommendation:** We should supplement our test generation with **test patch extraction** from the actual PR. When a PR includes test changes, those should be our primary validation source. The Pi agent should only generate tests when the PR doesn't include them.

---

## SWE-bench Test Taxonomy

| Type | Base Status | Gold Status | Purpose |
|------|-------------|-------------|---------|
| **`FAIL_TO_PASS`** | Fail | Pass | Resolution tests - proves the bug is fixed |
| **`PASS_TO_PASS`** | Pass | Pass | Maintenance tests - prevents regressions |
| **`FAIL_TO_FAIL`** | Fail | Fail | Already failing, remains failing |
| **`PASS_TO_FAIL`** | Pass | Fail | Tests removed/changed behavior (deprecated features) |

**Grading Logic:**
- `RESOLVED_FULL`: 100% F2P pass AND 100% P2P pass
- `RESOLVED_PARTIAL`: Some F2P pass AND 100% P2P pass
- `RESOLVED_NO`: Everything else

---

## SWE-bench Verified: The Filtering Problem

OpenAI's annotation effort found that **68.3% of original SWE-bench samples had issues**:

1. **Overly specific tests** - Tests check exact error message strings that a different valid fix might change
2. **Underspecified issues** - Issue description doesn't convey all requirements
3. **Environment setup problems** - Flaky or environment-dependent tests

This means even the gold standard benchmark has significant quality issues.

---

## Alternative Validation Approaches

### 1. Behavioral Reproduction (Highest Priority)

Instead of relying solely on unit tests, extract and run the **minimal reproducible example (MRE)** from the issue description.

**How it works:**
- Parse issue body for code snippets, shell commands, or step-by-step reproductions
- Run the MRE against the base commit (should reproduce the bug)
- Run the MRE against the patched commit (should NOT reproduce the bug)

**Pros:**
- Directly validates user-reported behavior
- Works for UI bugs, CLI bugs, performance issues that can't be unit tested
- Patch-agnostic (any fix that resolves the MRE is valid)

**Cons:**
- Not all issues have MREs
- MREs may have side effects (file system, network)
- Need sandboxed execution environment

**Implementation:**
- Extract MREs using LLM parsing of issue descriptions
- Store MREs as executable scripts (Python, shell, etc.)
- Run in Docker containers with appropriate tooling

### 2. Grader Agents (Secondary Signal)

Use an LLM to evaluate patch quality without running code.

**How it works:**
- Feed the grader: issue description, model patch, and optionally the gold patch
- Ask the grader to assess: correctness, completeness, regression risk
- Output structured scores

**Pros:**
- Can evaluate semantic correctness
- Works when tests are unavailable or incomplete
- Can assess code quality beyond pass/fail

**Cons:**
- Expensive (another LLM call)
- Subject to LLM biases and hallucinations
- Needs careful calibration

**Implementation:**
- Two-stage evaluation: fast unit tests first, grader agent for edge cases
- Use chain-of-thought reasoning to reduce hallucination
- Calibrate on human-annotated samples (SWE-bench Verified)

### 3. Test Patch Extraction (Baseline)

When the PR includes test changes, extract and use them directly.

**How it works:**
- Fetch the PR diff
- Extract only the test file changes
- Apply test patch to base commit
- Run tests
- Categorize results by pass/fail transitions

**Pros:**
- Exactly matches SWE-bench methodology
- Uses human-written tests (higher quality than generated)
- No LLM cost for test generation

**Cons:**
- Not all PRs modify tests
- Some test changes are tangential to the bug fix
- Still suffers from SWE-bench Verified issues (overly specific tests)

---

## Hybrid Validation Pipeline (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                    Hybrid Validation Pipeline               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Ingest Model Patch                                      │
│       │                                                     │
│       ▼                                                     │
│  2. Smoke Test (Import, Syntax, CLI health)                 │
│       │── Fail ──► REJECTED                                 │
│       ▼── Pass                                              │
│  3. PR Test Patch Evaluation (SWE-bench style)              │
│       │── If PR has test changes                            │
│       │   ├── Pass ──► RESOLVED (Primary)                   │
│       │   └── Fail ──► Proceed to 4                         │
│       │── If no PR test changes                             │
│       ▼   └── Proceed to 4                                  │
│  4. Behavioral Reproduction (Run Issue MRE)                 │
│       │── Pass ──► LIKELY_RESOLVED (Flag for review)        │
│       │── Fail ──► Proceed to 5                             │
│       ▼                                                     │
│  5. Grader Agent Evaluation (LLM-as-Judge)                  │
│       │── High Score ──► PARTIAL / UNCERTAIN                │
│       │── Low Score  ──► REJECTED                           │
│       ▼                                                     │
│  6. Human-in-the-Loop (Sampled subset)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Concrete Next Steps for Pi Lab

### Immediate (This Week)

1. **Extract PR test patches**
   - Modify case-builder to fetch the PR diff
   - Extract test file changes from the diff
   - Store test patches as artifacts
   - If test patch exists, use it for validation instead of/generated in addition to Pi agent tests

2. **Add behavioral reproduction field**
   - Add `reproduction_script` field to benchmark cases
   - Store MREs extracted from issue descriptions
   - Run MREs in validation runner

### Short-term (Next 2 Weeks)

3. **Grader agent prototype**
   - Create a new `workers/grader` package
   - Implement LLM-as-a-judge for patch evaluation
   - Design prompt template with chain-of-thought reasoning
   - Output structured JSON scores

4. **SWE-bench compatible harness**
   - Implement base/gold commit evaluation
   - Support FAIL_TO_PASS / PASS_TO_PASS categorization
   - Docker-based test execution for isolation

### Medium-term (Next Month)

5. **MRE extraction pipeline**
   - LLM-based parser for issue descriptions
   - Extract code snippets, shell commands, repro steps
   - Validate MREs by running against base commit
   - Store validated MREs in case metadata

6. **Test quality scoring**
   - Grade generated tests for: correctness, coverage, specificity
   - Flag overly specific tests (exact string matching)
   - Prefer behavioral tests over implementation-detail tests

---

## Research Sources

- SWE-bench paper: Jimenez et al., ICLR 2024 (arXiv:2310.06770)
- SWE-bench Verified: OpenAI + Princeton (openai.com/index/introducing-swe-bench-verified/)
- SWT-Bench: Mündler et al., NeurIPS 2024 (arXiv:2406.12952)
- PropR: Gissurarson et al., ICSE 2022
- AdaRubric: arXiv:2603.21362

---

## Open Questions

1. Should we prioritize test patch extraction over Pi agent test generation?
2. How do we handle PRs without test changes? (Current Pi agent approach)
3. What's the cost budget for grader agent evaluation per case?
4. Should we support multiple validation strategies per case and let users choose?
5. How do we validate UI/CLI issues that can't be tested with unit tests?
