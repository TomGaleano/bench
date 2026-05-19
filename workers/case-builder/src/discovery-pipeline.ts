import type { GitHubIssueRef } from "./github-ref.js";
import type { PullRequestCandidate } from "./pr-candidate.js";

export interface DiscoveryContext {
  issue: GitHubIssueRef;
  now: Date;
  dryRun: boolean;
  metadata: Record<string, unknown>;
}

export interface DiscoveryStageResult {
  candidates: PullRequestCandidate[];
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface DiscoveryStage {
  name: string;
  run(context: DiscoveryContext): Promise<DiscoveryStageResult>;
}

export interface DiscoveryPipeline {
  run(context: DiscoveryContext): Promise<DiscoveryStageResult>;
}

export function createDiscoveryPipeline(stages: readonly DiscoveryStage[]): DiscoveryPipeline {
  return {
    async run(context) {
      const candidates: PullRequestCandidate[] = [];
      const warnings: string[] = [];
      const metadata: Record<string, unknown> = {};

      for (const stage of stages) {
        const result = await stage.run(context);

        candidates.push(...result.candidates);
        warnings.push(...result.warnings.map((warning) => `${stage.name}: ${warning}`));

        if (result.metadata) {
          metadata[stage.name] = result.metadata;
        }
      }

      return { candidates, warnings, metadata };
    }
  };
}
