#!/usr/bin/env node
// render-ppirtv-phase.mjs
//
// Hook ZCode (compatível Claude Code): renderiza a barra visual de fases PPIRTV
// do workspace ativo, lendo diretamente `.ppirtv/flows/*.json`.
//
// Propósito: dar ao operador uma visão imediata de onde está o fluxo
// (Pensamentos → Planejamento → Implementação → Revisão → Teste → Validação)
// sem precisar abrir o MCP ou o ledger.
//
// Acionado por hooks SessionStart e Stop. Source-of-truth das fases:
// `dist/phase-profile.js` (FULL_PROFILE) do dex-PPIRTV.
//
// Saída: JSON `{"hookSpecificOutput":{"hookEventName":<e>,"additionalContext":<txt>}}`.
// Se o workspace não tiver `.ppirtv/flows/`, sai em silêncio (exit 0) — não polui
// workspaces que não usam PPIRTV.

import fs from 'node:fs';
import path from 'node:path';

// --- Canonical phase profile (espelha dist/phase-profile.js FULL_PROFILE) ---
const PHASES = ['pensamentos', 'planejamento', 'implementacao', 'revisao', 'teste', 'validacao'];
const META = {
  pensamentos:  { label: 'Pensamentos',   emoji: '🧠', letter: 'P', owner: 'Rita Reunião + Quele Questiona', desc: 'explorar problema, riscos e incertezas' },
  planejamento: { label: 'Planejamento',  emoji: '🗂️', letter: 'P', owner: 'Paula Planeja', desc: 'definir escopo, tarefas e critérios de pronto' },
  implementacao:{ label: 'Implementação', emoji: '🛠️', letter: 'I', owner: 'Ivo Implementa', desc: 'executar a mudança e registrar arquivos alterados' },
  revisao:      { label: 'Revisão',       emoji: '🔎', letter: 'R', owner: 'Renata Review', desc: 'revisar diff, barata scan e riscos de regressão' },
  teste:        { label: 'Teste',         emoji: '🧪', letter: 'T', owner: 'Tereza Testa', desc: 'rodar teste real e anexar evidência' },
  validacao:    { label: 'Validação',     emoji: '✅', letter: 'V', owner: 'Vera Veredito', desc: 'emitir veredito, risco residual e próximo passo' },
};

// --- Gates por fase (espelha FULL_PROFILE.gateRequirements) ---
// source: "flow" = campo direto do JSON do flow; "evidence" = flow.evidence;
// "verdict" = flow.verdicts; "provided" = decidido em runtime pelo gate_check
// (marcado ◔ no checklist, pois o JSON não guarda esse estado por chave).
const GATES = {
  pensamentos: [
    { key: 'goal',          label: 'objetivo nomeado',                  source: 'flow' },
    { key: 'context',       label: 'contexto mínimo conhecido',         source: 'flow' },
    { key: 'risks',         label: 'risco principal nomeado',           source: 'flow' },
    { key: 'uncertainties', label: 'incertezas marcadas como lacunas',  source: 'flow' },
  ],
  planejamento: [
    { key: 'scope_in',        label: 'escopo definido',              source: 'flow' },
    { key: 'scope_out',       label: 'fora do escopo definido',      source: 'flow' },
    { key: 'tasks',           label: 'tarefas ordenadas',            source: 'flow' },
    { key: 'expected_evidence', label: 'evidências esperadas definidas', source: 'flow' },
    { key: 'done_criteria',   label: 'critério de pronto definido',  source: 'flow' },
  ],
  implementacao: [
    { key: 'implementation_done', label: 'mudança executada ou bloqueio objetivo registrado', source: 'provided' },
    { key: 'changed_files',       label: 'arquivos alterados registrados',                    source: 'flow' },
  ],
  revisao: [
    { key: 'diff_reviewed',    label: 'diff revisado',                 source: 'provided' },
    { key: 'barata_scan',      label: 'barata nunca está sozinha aplicado', source: 'provided' },
    { key: 'regression_risks', label: 'riscos de regressão listados',  source: 'provided' },
  ],
  teste: [
    { key: 'test_executed', label: 'teste real executado ou limitação explícita', source: 'provided' },
    { key: 'evidence',      label: 'evidência anexada',                source: 'evidence' },
  ],
  validacao: [
    { key: 'verdict',                label: 'veredito registrado',           source: 'verdict' },
    { key: 'residual_risks',         label: 'risco residual registrado',     source: 'provided' },
    { key: 'next_step',              label: 'próximo passo definido',        source: 'provided' },
    { key: 'memoria_viva_reconciled', label: 'memoria-viva reconciliou continuidade', source: 'provided' },
  ],
};

// Resolve o valor de um requisito de gate a partir do flow.
// Retorna: 'met' (✓), 'missing' (✗), 'runtime' (◔ — precisa de gate_check).
function evalGate(flow, req) {
  if (req.source === 'provided') return 'runtime';
  if (req.source === 'evidence') {
    return (Array.isArray(flow.evidence) && flow.evidence.length) ? 'met' : 'missing';
  }
  if (req.source === 'verdict') {
    return (Array.isArray(flow.verdicts) && flow.verdicts.length) ? 'met' : 'missing';
  }
  // source === 'flow'
  let val;
  if (req.key === 'scope_in') val = flow.scope && flow.scope.in;
  else if (req.key === 'scope_out') val = flow.scope && flow.scope.out;
  else val = flow[req.key];
  const ok = Array.isArray(val) ? val.length > 0 : (val && String(val).trim());
  return ok ? 'met' : 'missing';
}

function renderGateChecklist(flow, phaseName) {
  const reqs = GATES[phaseName];
  if (!reqs || !reqs.length) return '';
  const evaluated = reqs.map(r => ({ ...r, state: evalGate(flow, r) }));
  const met = evaluated.filter(r => r.state === 'met').length;
  const total = evaluated.length;
  const head = `**Gate \`${phaseName}\` (${met}/${total}):**`;
  const lines = evaluated.map(r => {
    const mark = r.state === 'met' ? '[x]' : r.state === 'runtime' ? '[◔]' : '[ ]';
    const tail = r.state === 'runtime' ? '  _(runtime — gate_check)_' : '';
    return `- ${mark} ${r.label}${tail}`;
  });
  return [head, ...lines].join('\n');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function resolveWorkspace() {
  // Prioridade: argv[2] (hook passa ${ZCODE_PROJECT_DIR} explicitamente) → env → cwd.
  return process.argv[2]
      || process.env.ZCODE_PROJECT_DIR
      || process.env.CLAUDE_PROJECT_DIR
      || process.cwd();
}

// Detecta nome do evento a partir do stdin do hook; fallback Stop.
function detectEvent() {
  const raw = readStdin();
  if (!raw || !raw.trim()) return 'Stop';
  try {
    const j = JSON.parse(raw);
    return j.hook_event_name || j.eventName || j.event || 'Stop';
  } catch {
    return 'Stop';
  }
}

function loadFlows(flowsDir) {
  let files;
  try { files = fs.readdirSync(flowsDir).filter(f => f.endsWith('.json')); }
  catch { return []; }
  const out = [];
  for (const f of files) {
    const fp = path.join(flowsDir, f);
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const mtime = fs.statSync(fp).mtimeMs;
      out.push({ f, fp, mtime, data });
    } catch { /* fluxo corrompido — ignora */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// Preferencia: flow `active` (em andamento). Fallback: mais recente de qualquer status.
// Semantica de status PPIRTV: `active` = aberto; `complete`/`archived` = fechado.
function pickFlow(flows) {
  if (!flows.length) return null;
  const active = flows.filter(x => x.data.status === 'active');
  if (active.length) return active[0]; // já ordenado por mtime desc
  return flows[0]; // fallback: mais recente global
}

// phaseMarker foi removido: o output é minimalista, só a fase atual é exibida.

function lastVerdict(flow) {
  const vs = flow.verdicts || [];
  return vs.length ? vs[vs.length - 1] : (flow.verdict || null);
}

function renderBar(flow) {
  const cur = flow.phase || null;
  const status = flow.status || 'unknown';
  const v = lastVerdict(flow);
  const closed = status === 'archived' || status === 'complete';
  const positive = closed && (status === 'complete'
      || (v && (v.status === 'pronto' || v.status === 'pronto_com_ressalvas')));

  const lines = [];

  // Cabeçalho minimalista: SÓ a fase atual (com emoji + dono + descrição).
  if (cur && META[cur]) {
    const M = META[cur];
    const headEmoji = closed ? (positive ? '✅' : '⏸️') : '🎯';
    lines.push(`### ${headEmoji} ${M.letter}${M.emoji} ${M.label} · ${M.owner}`);
    lines.push(`_${M.desc}_`);
  } else if (cur) {
    lines.push(`### 🎯 PPIRTV — fase \`${cur}\` (pré-fluxo)`);
  } else {
    lines.push(`### 🎯 PPIRTV`);
  }

  const shortId = (flow.flow_id || '').replace(/^flow_/, '').split('_').slice(0, 2).join('_') || '—';
  lines.push(`flow \`${shortId}\` · status \`${status}\``);

  const goal = (flow.goal || '').slice(0, 90);
  if (goal) lines.push(`**Objetivo:** ${goal}`);

  const nTasks = (flow.tasks || []).length;
  const nDone = (flow.done_criteria || []).length;
  const nEv = (flow.evidence || []).length;
  lines.push(`tarefas: ${nTasks} · critérios de pronto: ${nDone} · evidências: ${nEv}`);

  // Checklist de gates da fase atual (só em flow aberto/não-concluído).
  if (!closed && cur && PHASES.includes(cur)) {
    const gateBlock = renderGateChecklist(flow, cur);
    if (gateBlock) { lines.push(''); lines.push(gateBlock); }
  }

  if (closed && !positive) {
    lines.push('_fechado sem veredito positivo — fluxo interrompido_');
  }
  if (v && closed) {
    lines.push(`veredito: \`${v.status || '—'}\`${v.rationale ? ' — ' + String(v.rationale).slice(0, 80) : ''}`);
  }
  return lines.join('\n');
}

function main() {
  const eventName = detectEvent();
  const workspace = resolveWorkspace();
  const flowsDir = path.join(workspace, '.ppirtv', 'flows');

  if (!fs.existsSync(flowsDir)) {
    // Workspace sem PPIRTV — silencioso.
    process.exit(0);
  }

  const flows = loadFlows(flowsDir);
  const picked = pickFlow(flows);
  if (!picked) process.exit(0);

  const context = renderBar(picked.data);
  const out = {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main();
