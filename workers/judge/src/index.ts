export type GoldEditAtom = {
  id: string;
  filePath: string;
  symbol?: string;
  behavior: string;
  required: boolean;
  weight: number;
};

export type AtomCoverage = {
  atomId: string;
  status: "covered" | "partial" | "missed";
  evidence?: string;
  rationale: string;
};

export type PlanScore = {
  total: number;
  atomCoverage: number;
  localization: number;
  testStrategy: number;
  specificity: number;
  riskAwareness: number;
  coverages: AtomCoverage[];
  judgeModelId: string;
  rubricVersion: string;
};

export function computeWeightedAtomCoverage(
  atoms: GoldEditAtom[],
  coverages: AtomCoverage[],
) {
  const byId = new Map(coverages.map((coverage) => [coverage.atomId, coverage]));
  const totalWeight = atoms.reduce((sum, atom) => sum + atom.weight, 0);
  if (totalWeight === 0) return 0;

  const matchedWeight = atoms.reduce((sum, atom) => {
    const coverage = byId.get(atom.id);
    const multiplier =
      coverage?.status === "covered" ? 1 : coverage?.status === "partial" ? 0.5 : 0;
    return sum + atom.weight * multiplier;
  }, 0);

  return matchedWeight / totalWeight;
}
