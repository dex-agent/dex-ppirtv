import { describe, expect, it } from "vitest";
import type { Evidence, Flow } from "../src/domain.js";
import {
  checkInTrailAlignment,
  evidenceCheckoutAccountability,
  evidenceQualityReasons,
  learningCheckoutAccountability,
  loopCheckoutAccountability,
  utilityCheckoutAccountability
} from "../src/ppirtv-checkin.js";
import { historyEvent, makeFlow } from "./helpers/policy-modules-fixture.js";

// D-52 (2026-11-16) — corte de rede ppirtv-checkin: as 6 lacunas (b) pagas por
// sonda (M1-M4, M6b, M7 SOBREVIVERAM contra a suíte) são as prestações de
// contas do checkout (trail_alignment + 4 accountability) e o ramo strong do
// evidenceQualityReasons. Caracterização: cada it trava o valor EXATO do campo
// sondado — a vigília re-mutada (MUTACOES/*-vigia.json) tem que falhar.
function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidence_id: "ev-1",
    flow_id: "flow_test",
    kind: "command",
    title: "suíte executada",
    content: "npm run check passou com exit 0",
    satisfies: [],
    parking_lot: [],
    gold_mining: [],
    created_at: "2026-11-09T00:00:00.000Z",
    ...overrides
  } as Evidence;
}

describe("checkin rede D-52: prestações de contas do checkout (lacunas b pagas)", () => {
  it("checkInTrailAlignment devolve o alinhamento exato do envelope com cwd (M1)", () => {
    const flow: Flow = makeFlow({
      goal_binding: {
        envelope: {
          workspace: process.cwd(),
          spt_path: ".agents/PLAN-TASKS/x.md",
          objective: "objetivo de teste",
          idempotency_key: "k1",
          evidence_required: true,
          required_evidence: ["ER-01"],
          requested_verdict_policy: "evidence_required",
          source: "teste"
        },
        started_at: "2026-11-16T00:00:00.000Z",
        last_seen_at: "2026-11-16T00:00:00.000Z"
      }
    });
    const alignment = checkInTrailAlignment(flow);
    expect(alignment.cwd_matches_workspace).toBe(true);
    expect(alignment.required_evidence_count).toBe(1);
    expect(alignment.evidence_required).toBe(true);
    expect(alignment.workspace).toBe(process.cwd());
  });

  it("evidenceCheckoutAccountability contabiliza strong e weak com totais exatos (M2)", () => {
    const strong = makeEvidence({
      evidence_id: "ev-strong",
      kind: "command",
      title: "validacao da fase com origem e objetivo",
      content: "procedimento: npm run check; resultado observado: pass; limitacao/risco residual declarado"
    });
    const weak = makeEvidence({ evidence_id: "ev-weak", content: undefined, title: "titulo seco", kind: "note" });
    const flow = makeFlow({ evidence: [strong, weak] });
    const accountability = evidenceCheckoutAccountability(flow);
    expect(accountability.total).toBe(2);
    expect(accountability.strong_count).toBe(1);
    expect(accountability.weak_count).toBe(1);
    expect(accountability.missing_context_count).toBe(0);
    expect(accountability.blocks_ready).toBe(false);
  });

  it("utilityCheckoutAccountability monta o painel M/G/E/P/C/B/L com counts exatos (M3)", () => {
    const flow = makeFlow();
    const utility = utilityCheckoutAccountability({
      flow,
      memory: {
        candidates_count: 3,
        written_count: 2,
        edit_queue: [{ item: "revisar L1 do corte" }],
        destination_warnings: ["destino ambiguo"]
      },
      learning: {
        garimpado: ["ouro A", "ouro B", "ouro C"],
        estacionado: ["item estacionado 1"],
        pontos_cegos: []
      },
      cooperation: { material_count: 2 },
      librarian: { worked: true },
      loop: { current: { count: 4, escalation: { level: "atencao" } } }
    });
    expect(utility.painel).toEqual([
      "M memoria: candidates=3, written=2, editaveis=1",
      "G garimpo: 3",
      "E estacionamento: 1",
      "P pontos_cegos: 0",
      "C cooperadores_materiais: 2",
      "B bibliotecario_graphify: worked",
      "L loops: atual=4, nivel=atencao"
    ]);
    expect(utility.edit_queue_count).toBe(1);
    expect(utility.warnings).toEqual(["destino ambiguo"]);
    expect(utility.next_use).toBe("revisar edit_queue antes de nova auto_write ou promocao L1/L2");
  });

  it("loopCheckoutAccountability conta gate_checks e bloqueados com assinatura (M4)", () => {
    const flow = makeFlow({
      history: [
        historyEvent("gate_checked", { status: "blocked", missing: ["review"] }),
        historyEvent("gate_checked", { status: "blocked", missing: ["review"] }),
        historyEvent("gate_checked", { status: "passed" })
      ]
    });
    const loop = loopCheckoutAccountability(flow, []);
    expect(loop.gate_checks_count).toBe(3);
    expect(loop.blocked_gate_checks_count).toBe(2);
    expect(loop.blocked_gate_checks_by_signature).toEqual([
      { signature: expect.stringContaining("review"), count: 2 }
    ]);
  });

  it("learningCheckoutAccountability separa garimpo, estacionamento e pontos cegos (M6b)", () => {
    const flow = makeFlow({
      gold_mining: ["ouro A do corte", "ponto cego: cobertura do checkout"],
      parking_lot: ["ferramenta lateral estacionada"]
    });
    const learning = learningCheckoutAccountability(flow);
    expect(learning.garimpado).toEqual(["ouro A do corte", "ponto cego: cobertura do checkout"]);
    expect(learning.estacionado).toEqual(["ferramenta lateral estacionada"]);
    expect(learning.pontos_cegos).toEqual(["ponto cego: cobertura do checkout"]);
    expect(learning.garimpo_count).toBe(2);
    expect(learning.estacionamento_count).toBe(1);
    expect(learning.pontos_cegos_count).toBe(1);
  });

  it("evidenceQualityReasons ramo strong declara contexto suficiente para auditoria (M7)", () => {
    expect(evidenceQualityReasons("strong", true, [])).toEqual([
      "evidencia contem contexto operacional suficiente para auditoria inicial"
    ]);
  });
});
