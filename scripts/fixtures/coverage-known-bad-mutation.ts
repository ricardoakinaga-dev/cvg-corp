import type { CoverageSummary } from "../verify-coverage.ts";

export const knownBadCoverageMutation: {
  id: string;
  description: string;
  mutatedSummary: CoverageSummary;
} = {
  id: "global-line-threshold-minus-0.01",
  description: "A coverage report just below the global line/statements threshold must be rejected.",
  mutatedSummary: {
    line: 79.99,
    branch: 65,
    functions: 75,
    statements: 79.99,
    statementMetric: {
      value: 79.99,
      source: "node-native-line-coverage",
      justification: "Fixture mutation of the explicit line-equivalent statements metric.",
    },
  },
};
