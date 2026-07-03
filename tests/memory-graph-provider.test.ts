import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GraphifyRecallProvider,
  MemoryLibrarian,
  NullMemoryGraphProvider,
  parseGraphifyNodes,
  type GraphifyCommandRunner
} from "../src/memory/index.js";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";

let tempRoot: string;
let workspace: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ppirtv-graph-provider-"));
  workspace = path.join(tempRoot, "workspace");
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  if (tempRoot.startsWith(os.tmpdir())) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("memory graph providers", () => {
  it("returns empty results from the null provider", async () => {
    const provider = new NullMemoryGraphProvider();

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("does not call Graphify when the provider is not enabled", async () => {
    let called = false;
    const runner: GraphifyCommandRunner = async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const provider = new GraphifyRecallProvider({ runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(called).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns a warning when graphify-out graph is missing", async () => {
    let called = false;
    const runner: GraphifyCommandRunner = async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const provider = new GraphifyRecallProvider({ enabled: true, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(called).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual(["graphify_graph_missing: graphify-out/graph.json"]);
  });

  it("turns Graphify command failures into warnings", async () => {
    await createGraph();
    const runner: GraphifyCommandRunner = async () => {
      return { exitCode: 1, stdout: "", stderr: "graph unavailable\n" };
    };
    const provider = new GraphifyRecallProvider({ enabled: true, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual(["graphify_query_failed: graph unavailable"]);
  });

  it("redacts secret-like Graphify runner errors before returning warnings", async () => {
    await createGraph();
    const runner: GraphifyCommandRunner = async () => {
      throw new Error("Authorization: Bearer abcdefghijklmnop");
    };
    const provider = new GraphifyRecallProvider({ enabled: true, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual(["graphify_query_failed: [redacted]"]);
  });

  it("turns Graphify timeouts into warnings", async () => {
    await createGraph();
    const runner: GraphifyCommandRunner = async () => {
      return { exitCode: null, stdout: "", stderr: "", timedOut: true };
    };
    const provider = new GraphifyRecallProvider({ enabled: true, timeoutMs: 25, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual(["graphify_timeout: 25ms"]);
  });

  it("marks useful Graphify results with source, question, path and destination", async () => {
    await createGraph();
    const seenArgs: string[][] = [];
    const runner: GraphifyCommandRunner = async (_command, args) => {
      seenArgs.push([...args]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: [
          "Traversal: BFS depth=2 | Start: ['MemoryLibrarian'] | 2 nodes found",
          "NODE MemoryLibrarian [src=src/memory/memory-hooks.ts loc=L7 community=]",
          "NODE beforePhase() [src=src/memory/memory-recall.ts loc=L8 community=]"
        ].join("\n")
      };
    };
    const provider = new GraphifyRecallProvider({ enabled: true, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Bibliotecario beforePhase",
      workspace
    });

    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).not.toContain("save-result");
    expect(seenArgs[0]).toEqual(["query", "Bibliotecario beforePhase", "--graph", path.join(workspace, "graphify-out", "graph.json"), "--budget", "1000"]);
    expect(result.warnings).toEqual([]);
    expect(result.items[0]).toMatchObject({
      source: "graphify",
      question: "Bibliotecario beforePhase",
      title: "MemoryLibrarian",
      path: "src/memory/memory-hooks.ts",
      observation: "Graphify node at L7",
      destination: "recall_hint"
    });
  });

  it("blocks secret-like questions before calling Graphify", async () => {
    await createGraph();
    let called = false;
    const runner: GraphifyCommandRunner = async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const provider = new GraphifyRecallProvider({ enabled: true, runner });

    const result = await provider.recall({
      flow_id: "flow_1",
      phase: "planejamento",
      question: "Authorization: Bearer abcdefghijklmnop",
      workspace
    });

    expect(called).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toContain("graphify_question_blocked");
  });

  it("parses Graphify nodes without carrying raw traversal text", () => {
    const hits = parseGraphifyNodes(
      [
        "Traversal: BFS depth=2 | Start: ['x'] | 1 nodes found",
        "NODE PpirtvStore [src=src/store.ts loc=L8 community=]",
        "EDGE PpirtvStore --contains [EXTRACTED]--> store.ts"
      ].join("\n"),
      "PpirtvStore ledger",
      workspace
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "graphify",
      question: "PpirtvStore ledger",
      title: "PpirtvStore",
      path: "src/store.ts",
      destination: "recall_hint"
    });
  });

  it("keeps librarian recall unchanged when Graphify is not enabled", async () => {
    await mkdir(path.join(workspace, ".agents"), { recursive: true });
    await writeFile(path.join(workspace, ".agents", "LEMBRANCA.md"), "- [GRAPHIFY-OFF] Bibliotecario lembra por L1 sem provider.\n", "utf8");
    const engine = new FlowEngine(new PpirtvStore(tempRoot));
    const flow = await engine.createFlow({ goal: "Bibliotecario L1 recall" });
    flow.goal_binding = {
      envelope: {
        workspace,
        spt_path: path.join(workspace, "trail.md"),
        objective: flow.goal,
        idempotency_key: "graphify-off-recall",
        evidence_required: true,
        required_evidence: [],
        requested_verdict_policy: "evidence_required",
        source: "test"
      },
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    const librarian = new MemoryLibrarian(tempRoot);

    const recalled = await librarian.beforePhase({ flow, phase: "planejamento" });

    expect(recalled.items.some((item) => item.source === "curated_l1")).toBe(true);
    expect(recalled.items.some((item) => item.source === "graphify")).toBe(false);
  });

  it("redacts provider warnings before the librarian persists recall summaries", async () => {
    const graphProvider = {
      recall: async (input: { flow_id: string; phase: "pensamentos" | "planejamento" | "implementacao" | "revisao" | "teste" | "validacao" }) => ({
        flow_id: input.flow_id,
        phase: input.phase,
        queried_at: new Date().toISOString(),
        items: [],
        warnings: ["token=abcdefghijklmnop"]
      })
    };
    const engine = new FlowEngine(new PpirtvStore(tempRoot));
    const flow = await engine.createFlow({ goal: "Bibliotecario warning redaction" });
    const librarian = new MemoryLibrarian(tempRoot, { graphProvider });

    const recalled = await librarian.beforePhase({ flow, phase: "planejamento" });

    expect(recalled.warnings).toContain("[redacted]");
    expect(JSON.stringify(recalled.warnings)).not.toContain("abcdefghijklmnop");
  });
});

async function createGraph(): Promise<void> {
  await mkdir(path.join(workspace, "graphify-out"), { recursive: true });
  await writeFile(path.join(workspace, "graphify-out", "graph.json"), "{}", "utf8");
}
