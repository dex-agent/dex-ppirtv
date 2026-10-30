#!/usr/bin/env node
// preflight SPT v3 — regras R1-R08 (S01..S08) + anti-drift S09.
// Uso: node preflight.mjs <spt.md> | node preflight.mjs --checksum <molde.md>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

const args = process.argv.slice(2);
const achados = [];
const add = (code, msg) => achados.push(`${code}: ${msg}`);

function loadFront(file) {
  const raw = readFileSync(file, "utf8");
  if (raw.includes("\r\n")) add("S07", "arquivo usa CRLF; use apenas LF (R7)");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { add("S00", "front matter ausente"); return null; }
  const doc = parseDocument(m[1]).toJS({ maxAliasCount: 100 });
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) { add("S00", "front matter invalido"); return null; }
  return doc;
}

function checkGraph(d) {
  const reqs = d.requirements || [];
  const tasks = d.tasks || [];
  const critByReq = new Map();
  for (const r of reqs) for (const c of (r.criteria || [])) critByReq.set(c.id, r.id);
  const badIds = [];
  const seen = new Set();
  const idOk = (id, pre) => typeof id === "string" && new RegExp(`^${pre}-\\d+$`).test(id);
  for (const r of reqs) {
    if (!idOk(r.id, "REQ")) badIds.push(String(r.id));
    if (seen.has(r.id)) badIds.push(String(r.id) + "#dup"); seen.add(r.id);
    for (const c of (r.criteria || [])) {
      if (!idOk(c.id, "C")) badIds.push(String(c.id));
      if (seen.has(c.id)) badIds.push(String(c.id) + "#dup"); seen.add(c.id);
      // R3 (S03): segunda oracao com verbo apos " e " ou ";"
      // shortcut: heuristica lexical, lapidar com corpus maior
      if (/;|\be\s+(retorna|existe|declara|cont[eé]m|imprime|termina)\b/i.test(String(c.statement || "")))
        add("S03", `criterio ${c.id} com possivel 2+ condicoes (R3): "${String(c.statement).slice(0, 70)}"`);
    }
  }
  for (const t of tasks) {
    if (!idOk(t.id, "A")) badIds.push(String(t.id));
    if (seen.has(t.id)) badIds.push(String(t.id) + "#dup"); seen.add(t.id);
    const dw = new Set(t.done_when || []);
    for (const c of dw) {
      const rid = critByReq.get(c);
      if (!rid) add("S02", `task ${t.id}: criterio ${c} inexistente (R2)`);
      else if (!(t.covers || []).includes(rid)) add("S02", `task ${t.id} usa ${c} de ${rid} fora do covers (R2)`);
    }
    for (const e of (t.evidence_requirements || [])) {
      if (!idOk(e.id, "ER")) badIds.push(String(e.id));
      if (seen.has(e.id)) badIds.push(String(e.id) + "#dup"); seen.add(e.id);
      if (!e.proves || !e.proves.length) add("S01", `${e.id}: proves vazio (R1)`);
      for (const p of (e.proves || [])) if (!dw.has(p)) add("S01", `${e.id} prova ${p} fora do done_when da ${t.id} (R1)`);
      const k = e.expectation && e.expectation.kind;
      if (!["boolean_assertion", "command_exit", "hash_equality", "measurement", "text"].includes(k))
        add("S04", `${e.id}: expectation kind ausente/invalido (R4)`);
      else if (k === "boolean_assertion" && typeof e.expectation.expected !== "boolean")
        add("S04", `${e.id}: boolean_assertion exige expected boolean (R4)`);
      else if (k === "command_exit" && !Number.isInteger(e.expectation.expected_exit_code))
        add("S04", `${e.id}: command_exit exige expected_exit_code inteiro (R4)`);
    }
  }
  if (badIds.length) add("S08", `ID fora do padrao estavel ou duplicado (R8): ${[...new Set(badIds)].join(", ")}`);
  if (!Array.isArray(d.closure_gates) || !d.closure_gates.length) add("S05", "closure_gates ausente/ vazio (R5)");
  if (!Array.isArray(d.gates) || !d.gates.length) add("S06", "gates do plano ausentes/ vazios (R6)");
  if (d.dex_contract !== "spt" || d.version !== 3) add("S00", "dex_contract: spt e version: 3 obrigatorios");
}

if (args[0] === "--checksum") {
  if (!args[1]) { console.error("uso: --checksum <arquivo-do-molde>"); process.exit(2); }
  const sha = createHash("sha256").update(readFileSync(args[1])).digest("hex");
  const schm = readFileSync(new URL("../SCHEMA/dex.spt.v3.schm.md", import.meta.url), "utf8");
  const m = schm.match(/MOLDE\.md sha256:([0-9a-f]{64})/);
  if (!m) add("S09", "registro de checksum ausente no SCHEMA/dex.spt.v3.schm.md");
  else if (m[1] !== sha) add("S09", `checksum divergente: arquivo ${sha.slice(0, 12)} x registro ${m[1].slice(0, 12)}`);
} else if (args[0]) {
  const d = loadFront(args[0]);
  if (d) checkGraph(d);
} else {
  console.error("uso: node preflight.mjs <spt.md> | node preflight.mjs --checksum <molde.md>");
  process.exit(2);
}
console.log(`preflight: achados=${achados.length}`);
for (const a of achados) console.log(a);
process.exit(achados.length ? 1 : 0);
