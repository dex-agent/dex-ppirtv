import { describe, expect, it } from "vitest";
import {
  cooperationCheckoutAccountability,
  hasOpenRequiredCooperationMeetingSignal,
  latestOpenMeeting,
  liveOpenMeetingIds,
  meetingKindForType,
  meetingOutcomeCounts,
  meetingOutcomeSummaries,
  meetingTypeForKind,
  requiredCooperationMeetingIdMissingForPositiveVerdict,
  requiredCooperationMeetingSignal,
  requiredCooperationStillActive,
} from "../src/meeting-policy.js";
import { historyEvent, makeFlow, makeMeeting } from "./helpers/policy-modules-fixture.js";

describe("meeting-policy integration (import direto do módulo)", () => {
  it("texto negativo de required_cooperation NÃO reativa o blocker (trigger exige positivo sem negação)", () => {
    const negativo = makeFlow({
      tasks: ["required_cooperation nao se aplica a este corte documental"],
    });
    expect(requiredCooperationStillActive(negativo, { status: "nao_pronto" })).toBe(false);

    const positivo = makeFlow({
      tasks: ["reuniao obrigatoria com cooperadores materiais neste corte"],
    });
    expect(requiredCooperationStillActive(positivo, {})).toBe(true);
  });

  it("verdict_recorded após o fiscal_block consome o sinal de meeting aberto", () => {
    const base = [
      historyEvent("meeting_opened", { meeting_id: "m1" }),
      historyEvent("fiscal_policy_blocked", {
        required_cooperation_diagnostics: { open_meeting_ids: ["m1"] },
      }),
    ];
    const vivo = makeFlow({ history: base });
    expect(requiredCooperationMeetingSignal(vivo)).toBe(true);
    expect(hasOpenRequiredCooperationMeetingSignal(vivo, ["m1"])).toBe(true);
    expect(liveOpenMeetingIds(vivo)).toEqual(["m1"]);

    const consumido = makeFlow({
      history: [...base, historyEvent("verdict_recorded", { verdict_id: "v1" })],
    });
    expect(requiredCooperationMeetingSignal(consumido)).toBe(false);
  });

  it("meeting fechado elegível sem meeting_id no verdict positivo exige retry com id", () => {
    const fechadoElegivel = [
      historyEvent("meeting_closed", {
        meeting_id: "m1",
        participants_minimum_satisfied: true,
        decision: "seguir com o corte",
        satisfies_blockers: ["required_cooperation"],
      }),
    ];
    const flow = makeFlow({ history: fechadoElegivel });

    expect(
      requiredCooperationMeetingIdMissingForPositiveVerdict(flow, { status: "pronto" })
    ).toBe(true);
    expect(
      requiredCooperationMeetingIdMissingForPositiveVerdict(flow, {
        status: "pronto",
        meeting_ids: ["m1"],
      })
    ).toBe(false);
    expect(
      requiredCooperationMeetingIdMissingForPositiveVerdict(flow, { status: "nao_pronto" })
    ).toBe(false);

    const comVerdictDepois = makeFlow({
      history: [...fechadoElegivel, historyEvent("verdict_recorded", { verdict_id: "v9" })],
    });
    expect(
      requiredCooperationMeetingIdMissingForPositiveVerdict(comVerdictDepois, { status: "pronto" })
    ).toBe(false);
  });

  it("meetingOutcomeSummaries cobre os 3 ramos: open, closed e recorded_legacy", () => {
    const flow = makeFlow({
      meetings: ["m-open", "m-closed", "m-legacy"],
      history: [
        historyEvent("meeting_opened", { meeting_id: "m-open" }),
        historyEvent("meeting_opened", { meeting_id: "m-closed" }),
        historyEvent("meeting_closed", { meeting_id: "m-closed", decision: "ok" }),
        historyEvent("meeting_recorded", { meeting_id: "m-legacy" }),
      ],
    });
    const summaries = meetingOutcomeSummaries(flow);
    const byId = new Map(summaries.map((s) => [String(s.meeting_id), s]));
    expect(String(byId.get("m-open")?.traceability_status)).toBe("open");
    expect(String(byId.get("m-closed")?.traceability_status)).toBe("closed_unconsumed");
    expect(byId.get("m-closed")?.reusable).toBe(true);
    expect(String(byId.get("m-legacy")?.traceability_status)).toBe("recorded_legacy");
    expect(meetingOutcomeCounts(flow)).toHaveProperty("open", 1);
    expect(meetingOutcomeCounts(flow)).toHaveProperty("recorded_legacy", 1);
  });

  it("meetingKindForType e meetingTypeForKind são inversos para os 4 kinds", () => {
    expect(meetingKindForType(undefined)).toBeUndefined();
    for (const kind of ["divergente", "convergente", "transversal", "decisao"] as const) {
      expect(meetingKindForType(meetingTypeForKind(kind))).toBe(kind);
    }
    expect(meetingTypeForKind("decisao")).toBe("decision");
  });

  it("cooperationCheckoutAccountability separa cooperadores materiais do total", () => {
    const flow = makeFlow({
      cooperators: [
        { name: "$chato", reason: "fiscal", material: true },
        { name: "$curioso", reason: "observador", material: false },
      ],
    });
    const accountability = cooperationCheckoutAccountability(flow);
    expect(accountability.material_count).toBe(1);
    expect(accountability.all).toHaveLength(2);
    expect(Array.isArray(accountability.suggested)).toBe(true);
  });

  it("latestOpenMeeting devolve o último aberto do kind pedido (DOCUMENTAL: ordem do array vence, opened_at é ignorado)", () => {
    const aberta = makeMeeting({ meeting_id: "m-2", kind: "decisao", status: "open" });
    const fechada = makeMeeting({ meeting_id: "m-1", kind: "decisao", status: "closed" });
    const outra = makeMeeting({ meeting_id: "m-3", kind: "divergente", status: "open" });
    expect(latestOpenMeeting([fechada, aberta, outra], "decisao")?.meeting_id).toBe("m-2");
    expect(latestOpenMeeting([fechada], "decisao")).toBeUndefined();
    // contrato documental (adversarial C1): a seleção é pela POSIÇÃO no array,
    // não por opened_at — fixado aqui como sentinela de comportamento
    const antigaDepois = makeMeeting({ meeting_id: "m-antiga", kind: "decisao", status: "open", opened_at: "2026-11-01T00:00:00.000Z" });
    const novaAntes = makeMeeting({ meeting_id: "m-nova", kind: "decisao", status: "open", opened_at: "2026-11-09T00:00:00.000Z" });
    expect(latestOpenMeeting([novaAntes, antigaDepois], "decisao")?.meeting_id).toBe("m-antiga");
  });
});
