import type { FlowEngine } from "./flow-engine.js";
import { REQUIRED_PROMPTS, REQUIRED_RESOURCES, REQUIRED_TOOLS, type MeetingType } from "./domain.js";
import { FULL_PROFILE } from "./phase-profile.js";
import { finalReportModel, gateFinalOutput, operationalTrashDefinition, promptGuidance, readyDefinition } from "./principles.js";

export const TOOL_NAMES = [...REQUIRED_TOOLS];
export const PROMPT_NAMES = [...REQUIRED_PROMPTS];
export const RESOURCE_URIS = [...REQUIRED_RESOURCES];

export function gatesTemplate(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(FULL_PROFILE.gateRequirements).map(([phase, requirements]) => [
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
      required_output: [
        "decisao",
        "motivo",
        "fora do escopo",
        "criterio de pronto",
        "risco aceito",
        "se decidir implementacao, caminho absoluto do SPEC-PLAN-TASKs em <WORKSPACE>\\.agents\\PLAN-TASKS\\YYYY-MM-DD-<slug>.md",
        "owner do trilho, status do plano e prompt de handoff/execucao; use /GOAL apenas quando o cliente suportar esse comando",
        "INDEX.md e ACTIVE.md atualizados quando houver persistencia local"
      ]
    },
    transversal: {
      use_when: ["mudanca cruza areas", "dependencias ocultas", "risco de regressao entre fronteiras"],
      required_output: ["areas afetadas", "impactos", "dono por area", "gates extras", "plano de rollback"]
    },
    decision: {
      use_when: ["regress_count >= 3", "loop ruim", "bloqueio material recorrente"],
      required_output: [
        "decisao final de fiscalizacao",
        "responsavel",
        "acao obrigatoria",
        "criterio para destravar ou encerrar",
        "consumo downstream posterior com meeting_id exato; fechamento, presenca e creditos nao provam eficacia"
      ]
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
    // Resource URIs have no detail argument. Preserve their historical full
    // contract while direct calls and checklist_render default to current-phase.
    return engine.renderChecklist(flowId, "full");
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
      "Se a decisao gerar implementacao, nao deixe o plano apenas na conversa.",
      "Exija ou registre o SPEC-PLAN-TASKs salvo em <WORKSPACE>\\.agents\\PLAN-TASKS\\YYYY-MM-DD-<slug>.md.",
      "Inclua caminho absoluto, owner do trilho, status do plano, prompt de handoff/execucao e atualizacao de INDEX.md/ACTIVE.md.",
      "Se o cliente suportar /GOAL, ele pode ser usado como exemplo de prompt de execucao, mas nao e contrato canonico do PPIRTV.",
      "Registre decisao rastreavel."
    ].join("\n"),
    "open-transversal-meeting": [
      `Abra reuniao transversal para ${flowId}.`,
      "Mapeie areas afetadas, impactos, donos, gates extras e rollback."
    ].join("\n"),
    "clean-house-review": [
      `Rode revisao de casa limpa para ${flowId}.`,
      "Aplique higiene_scan e trate a regra barata nunca esta sozinha.",
      "Aplique tambem: Nao podemos jogar ouro no lixo.",
      "Antes de descartar, mover para LIXEIRA, fechar estacionamento ou eliminar material antigo, garimpe aprendizados, evidencias e memorias uteis.",
      "Nunca crie L3 sem L2 e L1; nunca crie L2 sem L1.",
      "Separe achados acionaveis, ressalvas e itens fora de escopo.",
      operationalTrashGuidanceText(),
      guidance,
      "Use estacionamento/garimpo como aliases humanos para parking_lot/gold_mining."
    ].join("\n"),
    "final-verdict": [
      `Prepare veredito final para ${flowId}.`,
      "Compare objetivo, implementacao, evidencias, testes, risco residual e proximo passo.",
      "Use goal_verdict para fluxo GOAL/SPT oficial; use verdict_record apenas para flow legado/manual.",
      "Sem evidencia, registre ressalva ou nao_pronto.",
      "Se houve decisao de implementacao sem SPEC-PLAN-TASKs salvo em .agents\\PLAN-TASKS, declare que o plano ainda nao virou trilho PPIRTV.",
      readyDefinitionText(),
      gateFinalOutputText(),
      finalReportModelText(),
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

function readyDefinitionText(): string {
  const items = readyDefinition();
  if (items.length === 0) {
    return "Definicao de pronto: validar objetivo, evidencias, bloqueios, riscos e acoes futuras antes de declarar pronto.";
  }
  return ["Definicao de pronto:", ...items.map((item) => `- ${item}`)].join("\n");
}

function gateFinalOutputText(): string {
  const items = gateFinalOutput();
  if (items.length === 0) {
    return "Gate Final PPIRTV: declarar principios acionados, evidencias, bloqueios, validacao e risco restante.";
  }
  return ["Gate Final PPIRTV:", ...items.map((item) => `- ${item}`)].join("\n");
}

function finalReportModelText(): string {
  const items = finalReportModel();
  if (items.length === 0) {
    return "Modelo de relatorio final PPIRTV: informe objetivo atendido, arquivos alterados, evidencias, validacao, risco restante e status final.";
  }
  return ["Modelo de relatorio final PPIRTV:", "```text", "PPIRTV:", ...items.map(reportModelLine), "```"].join("\n");
}

function reportModelLine(item: string): string {
  return item.includes(":") ? `- ${item}` : `- ${item}:`;
}

function operationalTrashGuidanceText(): string {
  const definition = operationalTrashDefinition();
  if (!definition || definition.includes.length === 0) {
    return "Lixo operacional: remover ou justificar temporarios, codigo morto, docs contraditorias e artefatos sem destino depois de garimpar aprendizados uteis.";
  }
  return [
    "Lixo operacional inclui:",
    ...definition.includes.map((item) => `- ${item}`),
    definition.rule ? `Regra: ${definition.rule}` : "Regra: antes de remover, garimpar evidencias e aprendizados uteis."
  ].join("\n");
}
