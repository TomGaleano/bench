import type { TestBuilderCandidate } from "./test-builder-candidate.js";

export interface CaseBuilderValidationIssue {
  code: string;
  message: string;
  path?: string;
  severity: "warning" | "error";
}

export interface CaseBuilderValidationResult {
  ok: boolean;
  issues: CaseBuilderValidationIssue[];
}

export interface CaseBuilderValidator {
  name: string;
  validate(candidate: TestBuilderCandidate): Promise<CaseBuilderValidationIssue[]>;
}

export class CaseBuilderValidationPipeline {
  constructor(private readonly validators: readonly CaseBuilderValidator[]) {}

  async validate(candidate: TestBuilderCandidate): Promise<CaseBuilderValidationResult> {
    const issues: CaseBuilderValidationIssue[] = [];

    for (const validator of this.validators) {
      const validatorIssues = await validator.validate(candidate);
      issues.push(
        ...validatorIssues.map((issue) => ({
          ...issue,
          code: `${validator.name}.${issue.code}`
        }))
      );
    }

    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      issues
    };
  }
}
