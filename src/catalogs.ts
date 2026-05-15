import type { FlowEngine } from "./flow-engine.js";
import { GATE_REQUIREMENTS, REQUIRED_PROMPTS, REQUIRED_RESOURCES, REQUIRED_TOOLS, type MeetingType } from "./domain.js";
import { promptGuidance } from "./principles.js";

export const TOOL_NAMES = [...REQUIRED_TOOLS];
export const PROMPT_NAMES = [...REQUIRED_PROMPTS];
export const RESOURCE_URIS = [...REQUIRED_RESOURCES];

export function gatesTemplate(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(GATE_REQUIREMENTS).map(([phase, requirements]) => [
      phase,
      requirements.map((requirement) => ({
        key: requirement.key,
        label: requirement.label,
        source: requirement.source
      }))
    ])
  );
}

export function meetingsTemplate(): Record<MeetingType, Record<string, unknown>> {
  return {
    divergent: {
      use_when: ["problema mal definido", "bug recorrente", "loop", "mais de uma abordagem plausivel"],
      required_output: ["perguntas abertas", "hipoteses", "riscos", "alternativas", "criterios para escolher"]
    },
    convergent: {
      use_when: ["alternativas levantadas", "necessidade de menor trilho", "escopo crescendo"],
      required_output: ["decisao", "motivo", "fora do escopo", "criterio de pronto", "risco aceito"]
    },
    transversal: {
      use_when: ["mudanca cruza areas", "dependencias ocultas", "risco de regressao entre fronteiras"],
      required_output: ["areas afetadas", "impactos", "dono por area", "gates extras", "plano de rollback"]
    }
  };
}

export function mcpReference(): Record<string, unknown> {
  return {
    transport: "stdio",
    state: "Every operation receives or returns an explicit flow_id.",
    tools: TOOL_NAMES,
    resources: RESOURCE_URIS,
    prompts: PROMPT_NAMES,
    source_docs: [
      "https://modelcontextprotocol.io/docs/learn/server-concepts",
      "https://modelcontextprotocol.io/specification/draft/server/tools",
      "https://modelcontextprotocol.io/specification/2025-06-18/server/prompts",
      "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
    ]
  };
}

export async function resourceText(engine: FlowEngine, uri: string): Promise<unknown> {
  if (uri === "ppirtv://flows") {
    const flows = await engine.store.listFlows();
    return flows.map((flow) => ({
      flow_id: flow.flow_id,
      goal: flow.goal,
      phase: flow.phase,
      status: flow.status,
      updated_at: flow.updated_at
    }));
  }
  if (uri === "ppirtv://templates/gates") {
    return gatesTemplate();
  }
  if (uri === "ppirtv://templates/meetings") {
    return meetingsTemplate();
  }
  if (uri === "ppirtv://reference/mcp") {
    return mcpReference();
  }
  const match = uri.match(/^ppirtv:\/\/flow\/([^/]+)(?:\/(checklist|ledger|meetings))?$/);
  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }
  const [, flowId, kind] = match;
  if (!kind) {
    return engine.status(flowId);
  }
  if (kind === "checklist") {
    return engine.renderChecklist(flowId);
  }
  if (kind === "ledger") {
    return engine.store.readLedger(flowId);
  }
  if (kind === "meetings") {
    return engine.store.listMeetings(flowId);
  }
  throw new Error(`Unknown resource kind: ${kind}`);
}

export function promptText(name: string, args: Record<string, unknown>): string {
  const flowId = typeof args.flow_id === "string" ? args.flow_id : "<flow_id>";
  const goal = typeof args.goal === "string" ? args.goal : "<objetivo>";
  const context = typeof args.context === "string" ? args.context : "<contexto>";
  const guidance = principleGuidanceText();
  const prompts: Record<string, string> = {
    "start-ppirtv-flow": [
      "Inicie um flow PPIRTV pelo harness.",
      `Objetivo: ${goal}`,
      `Contexto: ${context}`,
      "Perguntas minimas: objetivo, contexto conhecido, risco principal e lacunas a confirmar.",
      guidance,
      "Use flow_create e registre flow_id explicitamente."
    ].join("\n"),
    "run-phase-gate": [
      `Rode o gate da fase atual para ${flowId}.`,
      "Use gate_check antes de flow_advance.",
      "Se bloquear, responda com missing/next/back_to e aliases humanos: faltando/proximo/voltar_para.",
      guidance,
      "Mantenha flow_id explicito em toda acao."
    ].join("\n"),
    "open-divergent-meeting": [
      `Abra reuniao divergente para ${flowId}.`,
      "Levante perguntas, hipoteses, riscos, alternativas e criterios de escolha.",
      "Registre com meeting_open e meeting_record."
    ].join("\n"),
    "open-convergent-meeting": [
      `Abra reuniao convergente para ${flowId}.`,
      "Escolha menor trilho, motivo, fora do escopo, criterio de pronto e risco aceito.",
      "Registre decisao rastreavel."
    ].join("\n"),
    "open-transversal-meeting": [
      `Abra reuniao transversal para ${flowId}.`,
      "Mapeie areas afetadas, impactos, donos, gates extras e rollback."
    ].join("\n"),
    "clean-house-review": [
      `Rode revisao de casa limpa para ${flowId}.`,
      "Aplique higiene_scan e trate a regra barata nunca esta sozinha.",
      "Separe achados acionaveis, ressalvas e itens fora de escopo.",
      guidance,
      "Use estacionamento/garimpo como aliases humanos para parking_lot/gold_mining."
    ].join("\n"),
    "final-verdict": [
      `Prepare veredito final para ${flowId}.`,
      "Compare objetivo, implementacao, evidencias, testes, risco residual e proximo passo.",
      "Use verdict_record. Sem evidencia, registre ressalva ou nao_pronto.",
      guidance,
      "Creditos ativos so devem aparecer quando houver contribuicao material registrada."
    ].join("\n")
  };
  const prompt = prompts[name];
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return prompt;
}

function principleGuidanceText(): string {
  const guidance = promptGuidance();
  if (guidance.length === 0) {
    return "Principios: consulte fonte viva do projeto antes de executar.";
  }
  return ["Principios operacionais:", ...guidance.map((item) => `- ${item}`)].join("\n");
}
