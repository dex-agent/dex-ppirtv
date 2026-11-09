// ISSUE-LOCAL-0005: declarações do validador de camping (JS sem tipos) para o
// typecheck de tests/ — descreve o contrato consumido por
// tests/flow-engine-boundary.test.ts; a fonte da verdade é o .mjs adjacente.
export interface FlowEngineChangeDeclaration {
  id?: string;
  date?: string;
  spt_path?: string;
  owner?: string;
  mode?: string;
  [key: string]: unknown;
}

export interface BoundaryReceipt {
  status?: string;
  mode?: string;
  requested_mode?: string;
  reasons?: string[];
  metrics?: {
    nonblank_lines: { delta: number; [key: string]: unknown };
    decision_points: { delta: number; [key: string]: unknown };
    guard_expressions: { delta: number; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export declare function analyzeFlowEngineSource(
  source: string,
  label?: string
): {
  nonblank_lines: number;
  decision_points: number;
  guard_expressions: number;
  symbols?: unknown;
  [key: string]: unknown;
};
export declare function evaluateFlowEngineChange(input: {
  baseSource?: string | null;
  headSource?: string | null;
  declaration?: FlowEngineChangeDeclaration | null;
  history?: FlowEngineChangeDeclaration[];
  flowEngineChanged?: boolean;
  [key: string]: unknown;
}): BoundaryReceipt;
export declare function runBoundaryCli(args?: {
  cwd?: string;
  argv?: string[];
  [key: string]: unknown;
}): {
  exitCode: number;
  output: string;
  json?: boolean;
  [key: string]: unknown;
};
