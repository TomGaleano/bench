export type TestSelector = {
  id: string;
  kind: "FAIL_TO_PASS" | "PASS_TO_PASS";
  command: string;
  filePath?: string;
  testName?: string;
};

export type EvaluationInput = {
  runId: string;
  caseVersionId: string;
  repoUrl: string;
  baseCommit: string;
  modelPatch: string;
  tests: TestSelector[];
  timeoutSeconds: number;
};

export type TestEvaluationResult = {
  testId: string;
  kind: TestSelector["kind"];
  status: "passed" | "failed" | "skipped" | "timeout";
  durationMs?: number;
  logArtifactKey?: string;
};

export type EvaluationResult = {
  runId: string;
  resolved: boolean;
  failToPassPassed: number;
  failToPassTotal: number;
  passToPassPassed: number;
  passToPassTotal: number;
  tests: TestEvaluationResult[];
  rawResultArtifactKey?: string;
};

export function summarizeEvaluation(
  runId: string,
  tests: TestEvaluationResult[],
): EvaluationResult {
  const failToPass = tests.filter((test) => test.kind === "FAIL_TO_PASS");
  const passToPass = tests.filter((test) => test.kind === "PASS_TO_PASS");
  const failToPassPassed = failToPass.filter((test) => test.status === "passed").length;
  const passToPassPassed = passToPass.filter((test) => test.status === "passed").length;

  return {
    runId,
    resolved:
      failToPass.length > 0 &&
      failToPassPassed === failToPass.length &&
      passToPassPassed === passToPass.length,
    failToPassPassed,
    failToPassTotal: failToPass.length,
    passToPassPassed,
    passToPassTotal: passToPass.length,
    tests,
  };
}
