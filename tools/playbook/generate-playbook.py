#!/usr/bin/env python3
"""generate-playbook.py (versao generica da dex-playbook-entrada).

Projecao PLAYBOOK.md + PLAYBOOK.index.json (schema project.playbook.index.v1)
de AGENTS.md e/ou outros markdowns de regras + napkin + trilho do repo.

- Deterministico: sem timestamps; --write idempotente; --check diff byte-a-byte.
- So ponteiros e extratos verbatim curtos; a decisao completa mora na fonte.
- Nenhum artefato do playbook mora em .agents/ (nao viaja no clone).
- Selo pb-<8hex> = sha256(localizador#ancora)[:8]; so existe na projecao.

Fontes (nesta ordem de precedencia):
  1. --sources caminho1,caminho2  (override explicito)
  2. <repo>/tools/playbook/playbook-sources.txt (1 por linha; escrito pelo
     instalador da dex-playbook-entrada)
  3. auto-deteccao: AGENTS.md, 00-governanca-mesa-de-skills.md,
     .agents/napkin.md, .agents/PLAN-TASKS/ACTIVE.md (os que existirem)

Papel de cada fonte: arquivo terminado em napkin.md = runbook (itens datados);
demais .md = regras (secoes '## ' com token CAPS-hifen >=12 em backticks,
primeiro token top-down; listas numeradas = rotas). Faixas entre marcadores
<!-- nome:start/end --> (graphify-local, registry-catalog-shadow,
playbook-pointer) sao excluidas.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SCHEMA = "project.playbook.index.v1"
GENERATED_BY = "tools/playbook/generate-playbook.py"
AUTHORITY = "derived_projection"
CONFIG_NAME = "tools/playbook/playbook-sources.txt"
DEFAULT_CANDIDATES = [
    "AGENTS.md",
    "00-governanca-mesa-de-skills.md",
    ".agents/napkin.md",
    ".agents/PLAN-TASKS/ACTIVE.md",
]

GENERATED_MARKERS = ("graphify-local", "registry-catalog-shadow", "playbook-pointer")

MARK_RE = re.compile(r"<!--\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(start|end)\s*-->", re.IGNORECASE)
TOKEN_RE = re.compile(r"`([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)`")
NAPKIN_RE = re.compile(
    r"^(\d+)\.\s*\*\*\[(\d{4}-\d{2}-\d{2})(?:,\s*[^\]]+)?\]\s*"
    r"(?:\[([A-Z][A-Z0-9_-]{5,})\]\s*)?(.+?)\*\*"
)
FACA_RE = re.compile(r"Fa[cç]a em vez disso:\s*(.+)")
ROUTE_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
MESA_KEY_RE = re.compile(r"^(Status|Escopo|Governance-Version):\s*(.+)$", re.MULTILINE)


def clip(text, limit):
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "..."


def seal_of(locator, anchor):
    return "pb-" + hashlib.sha256((locator + "#" + anchor).encode("utf-8")).hexdigest()[:8]


def read_lines(path):
    return path.read_text(encoding="utf-8-sig").splitlines()


def generated_mask(lines):
    mask = [False] * len(lines)
    stack = []
    lowered = {m.lower() for m in GENERATED_MARKERS}
    for idx, line in enumerate(lines):
        m = MARK_RE.search(line)
        if m and m.group(1).lower() in lowered:
            mask[idx] = True
            if m.group(2).lower() == "start":
                stack.append(m.group(1).lower())
            elif stack:
                stack.pop()
            continue
        mask[idx] = bool(stack)
    return mask


def split_sections(lines, mask):
    heads = [i for i, ln in enumerate(lines) if ln.startswith("## ")]
    sections = []
    for pos, start in enumerate(heads):
        end = heads[pos + 1] if pos + 1 < len(heads) else len(lines)
        if mask[start]:
            continue
        sections.append((lines[start][3:].strip(), start, lines[start:end]))
    return sections


def parse_rules_file(repo, rel):
    path = repo / Path(rel)
    if not path.exists():
        return [], []
    lines = read_lines(path)
    mask = generated_mask(lines)
    sections = split_sections(lines, mask)
    rules, undecoded = [], []
    for title, start, body in sections:
        text = "\n".join(body)
        tokens = [t for t in TOKEN_RE.findall(text) if len(t) >= 12]
        anchor = "%s#L%d-L%d" % (rel, start + 1, start + len(body))
        if not tokens:
            undecoded.append({"titulo": title, "ancora": "%s#L%d" % (rel, start + 1)})
            continue
        locator = tokens[0]
        gatilho = "ndeclarado"
        for ln in body:
            if "gatilho" in ln.lower():
                gatilho = clip(ln, 140)
                break
        extrato = ""
        for ln in body[1:]:
            if ln.strip():
                extrato = clip(ln, 140)
                break
        rotas = []
        for ln in body[1:]:
            r = ROUTE_RE.match(ln)
            if r and r.group(1).strip():
                rotas.append(clip(r.group(1), 60))
            if len(rotas) == 4:
                break
        rules.append({
            "seal": seal_of(locator, anchor),
            "locator": locator,
            "title": title,
            "gatilho": gatilho,
            "extrato": extrato,
            "rotas": rotas,
            "fonte": anchor,
        })
    return rules, undecoded


def parse_mesa_keys(repo, rel):
    path = repo / Path(rel)
    if not path.exists():
        return {}
    keys = {}
    for m in MESA_KEY_RE.finditer(path.read_text(encoding="utf-8-sig")):
        keys.setdefault(m.group(1), clip(m.group(2), 140))
    return keys


def parse_mesa_sections(repo, rel):
    path = repo / Path(rel)
    if not path.exists():
        return []
    lines = read_lines(path)
    return [
        {"titulo": ln[3:].strip(), "ancora": "%s#L%d" % (rel, i + 1)}
        for i, ln in enumerate(lines) if ln.startswith("## ")
    ]


def parse_napkin(repo, rel):
    path = repo / Path(rel)
    if not path.exists():
        return []
    lines = read_lines(path)
    items = []
    for i, ln in enumerate(lines):
        m = NAPKIN_RE.match(ln)
        if not m:
            continue
        block = [ln]
        j = i + 1
        while j < len(lines) and lines[j].strip():
            block.append(lines[j])
            j += 1
        faca = ""
        for bl in block:
            f = FACA_RE.search(bl)
            if f:
                faca = clip(f.group(1), 140)
                break
        items.append({
            "data": m.group(2),
            "localizador": m.group(3) or "",
            "titulo": clip(m.group(4), 140),
            "faca": faca,
            "ancora": "%s#L%d" % (rel, i + 1),
            "local": True,
        })
    return items


def resolve_sources(repo, override):
    if override:
        rels = [s.strip().replace("\\", "/") for s in override.split(",") if s.strip()]
    else:
        cfg = repo / CONFIG_NAME
        if cfg.exists():
            rels = [ln.strip().replace("\\", "/") for ln in read_lines(cfg) if ln.strip() and not ln.startswith("#")]
        else:
            rels = list(DEFAULT_CANDIDATES)
    solved = []
    for rel in rels:
        if (repo / Path(rel)).exists():
            solved.append(rel)
    return solved


def git_ls_files(repo):
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "ls-files"],
            capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout
    except Exception:
        return set()
    return {ln.strip().replace("\\", "/") for ln in out.splitlines() if ln.strip()}


def sources_table(repo, rels, sent):
    rows = []
    for rel in rels:
        digest = hashlib.sha256((repo / Path(rel)).read_bytes()).hexdigest()
        rows.append({"caminho": rel, "sha256": digest, "enviado": rel in sent})
    return rows


def revision_of(rows, only_sent=False):
    parts = []
    for row in rows:
        if only_sent and not row["enviado"]:
            continue
        parts.append(row["caminho"] + ":" + row["sha256"])
    return "sha256:" + hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def collect(repo, override):
    rels = resolve_sources(repo, override)
    if not rels:
        print("SEM FONTES: nenhum arquivo de regras existe neste repo (exit 3)")
        print("  aponte com --sources ou crie um AGENTS.md antes (exit 3)")
        sys.exit(3)
    sent = git_ls_files(repo)
    rules, undecoded = [], []
    mesa_rel = "00-governanca-mesa-de-skills.md"
    napkin_rel = next((r for r in rels if r.endswith("napkin.md")), "")
    plan_rel = next((r for r in rels if r == ".agents/PLAN-TASKS/ACTIVE.md"), "")
    for rel in rels:
        if rel == napkin_rel or rel == plan_rel:
            continue
        r, u = parse_rules_file(repo, rel)
        rules.extend(r)
        undecoded.extend(u)
    return {
        "repo_name": repo.resolve().name,
        "rules": rules,
        "undecoded": undecoded,
        "mesa_keys": parse_mesa_keys(repo, mesa_rel) if mesa_rel in rels else {},
        "mesa_secoes": parse_mesa_sections(repo, mesa_rel) if mesa_rel in rels else [],
        "tem_mesa": mesa_rel in rels,
        "napkin": parse_napkin(repo, napkin_rel) if napkin_rel else [],
        "plan_rel": plan_rel,
        "fontes": sources_table(repo, rels, sent),
    }


def render(repo, data):
    name = repo.resolve().name
    rows = data["fontes"]
    out = []
    out.append("---")
    out.append('name: "%s playbook"' % name)
    out.append('description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."')
    out.append("type: playbook")
    out.append('generated_by: "%s"' % GENERATED_BY)
    out.append("authority: %s" % AUTHORITY)
    out.append('sources_revision: "%s"' % revision_of(rows))
    out.append('sent_revision: "%s"' % revision_of(rows, only_sent=True))
    out.append("do_not_edit: true")
    out.append("---")
    out.append("# Playbook - %s" % name)
    out.append("")
    out.append("## Como usar este playbook")
    out.append("")
    out.append("Projecao GERADA das regras de decisao deste repo; a decisao completa mora na fonte citada.")
    out.append("Executar uma regra exige ler a fonte; extratos terminam em '...' quando truncados.")
    out.append("Regenerar apos editar fonte: `python -B %s --repo . --write`." % GENERATED_BY)
    out.append("Verificar frescor: `python -B %s --repo . --check` (exit 0 limpo, exit 2 drift)." % GENERATED_BY)
    out.append("Ativar trava de commit: `git config core.hooksPath tools/playbook/hooks`.")
    out.append("Destinatario do projeto: `--check-sent` valida as fontes enviadas neste clone.")
    out.append("")
    out.append("## Regras de decisao (plaquinhas)")
    out.append("")
    by_loc = {r["locator"]: r for r in data["rules"]}
    assoc = {}
    for it in data["napkin"]:
        if it["localizador"] and it["localizador"] in by_loc:
            assoc.setdefault(it["localizador"], []).append(it)
    if not data["rules"]:
        out.append("- (nenhuma regra com localizador decodificada neste repo; veja Secoes nao decodificadas)")
    for rule in data["rules"]:
        out.append("### %s" % rule["title"])
        out.append("")
        out.append("- Localizador: `%s`" % rule["locator"])
        out.append("- Gatilho: %s" % rule["gatilho"])
        out.append("- Extrato: %s" % rule["extrato"])
        if rule["rotas"]:
            out.append("- Rotas (nomes, na ordem):")
            for r in rule["rotas"]:
                out.append("  - %s" % r)
        out.append("- Fonte: `%s`" % rule["fonte"])
        out.append("- Selo: `%s`" % rule["seal"])
        for it in assoc.get(rule["locator"], []):
            out.append("- Procedimento associado: [%s] %s - %s -> `%s (local)`"
                       % (it["data"], it["titulo"], it["faca"] or "ver fonte", it["ancora"]))
        out.append("")
    if data["tem_mesa"]:
        keys, mesa_secs = data["mesa_keys"], data["mesa_secoes"]
        out.append("## Mesa de governanca")
        out.append("")
        out.append("- Status: %s" % keys.get("Status", "ndeclarado"))
        out.append("- Escopo: %s" % keys.get("Escopo", "ndeclarado"))
        out.append("- Governance-Version: %s" % keys.get("Governance-Version", "ndeclarado"))
        out.append("- Indice (%d secoes, contagem derivada em runtime):" % len(mesa_secs))
        for sec in mesa_secs:
            out.append("  - %s -> `%s`" % (sec["titulo"], sec["ancora"]))
        out.append("")
    out.append("## Runbook <-> Playbook (procedimentos)")
    out.append("")
    for it in data["napkin"]:
        out.append("- [%s] %s - Faca: %s -> `%s (local)`"
                   % (it["data"], it["titulo"], it["faca"] or "ver fonte", it["ancora"]))
    if not data["napkin"]:
        out.append("- (napkin ausente nesta copia)")
    out.append("")
    out.append("## Plano de execucao vigente")
    out.append("")
    if data["plan_rel"]:
        out.append("-> `%s (local)` - nao viaja no clone." % data["plan_rel"])
    else:
        out.append("- (sem trilho declarado neste repo)")
    out.append("")
    out.append("## Fontes e revisao")
    out.append("")
    out.append("| caminho | sha256 | Enviado? |")
    out.append("| --- | --- | --- |")
    for row in rows:
        out.append("| `%s` | `%s` | %s |" % (row["caminho"], row["sha256"], "sim" if row["enviado"] else "nao"))
    out.append("")
    out.append("## Superficie enviada vs local")
    out.append("")
    out.append("- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).")
    out.append("- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).")
    out.append("- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.")
    out.append("")
    out.append("## Secoes nao decodificadas")
    out.append("")
    if data["undecoded"]:
        for u in data["undecoded"]:
            out.append("- %s -> `%s` (sem token de localizador)" % (u["titulo"], u["ancora"]))
    else:
        out.append("- (nenhuma)")
    out.append("")
    return "\n".join(out)


def build_index(data):
    return {
        "schema": SCHEMA,
        "generated_by": GENERATED_BY,
        "authority": AUTHORITY,
        "repo_name": data["repo_name"],
        "sources_revision": revision_of(data["fontes"]),
        "sent_revision": revision_of(data["fontes"], only_sent=True),
        "rules": data["rules"],
        "mesa": {
            "status": data["mesa_keys"].get("Status", ""),
            "escopo": data["mesa_keys"].get("Escopo", ""),
            "governance_version": data["mesa_keys"].get("Governance-Version", ""),
            "secoes": data["mesa_secoes"],
            "total_derived": len(data["mesa_secoes"]),
        },
        "runbook": data["napkin"],
        "nao_decodificadas": data["undecoded"],
        "fontes": data["fontes"],
    }


def section_diff(old_text, new_text):
    def secs(t):
        parts = t.split("\n## ")
        return {"## " + p.splitlines()[0] if i else p.splitlines()[0]: p for i, p in enumerate(parts)}
    old, new = secs(old_text), secs(new_text)
    return [k for k in sorted(set(old) | set(new)) if old.get(k) != new.get(k)]


def write_bytes(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def main():
    ap = argparse.ArgumentParser(description="Projecao PLAYBOOK (generico, dex-playbook-entrada)")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--sources", default="", help="override: caminho1,caminho2 (POSIX, relativos ao repo)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--check-sent", action="store_true")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()

    data = collect(repo, args.sources)
    md_text = render(repo, data)
    idx_text = json.dumps(build_index(data), ensure_ascii=False, indent=2) + "\n"
    md_path, idx_path = repo / "PLAYBOOK.md", repo / "PLAYBOOK.index.json"

    if args.write:
        write_bytes(md_path, md_text)
        write_bytes(idx_path, idx_text)
        print("PLAYBOOK written: %d regras, %d itens runbook, %d nao decodificadas, fontes: %s"
              % (len(data["rules"]), len(data["napkin"]), len(data["undecoded"]), ", ".join(r["caminho"] for r in data["fontes"])))
        return 0

    if args.check:
        problems = []
        for path, want, label in ((md_path, md_text, "PLAYBOOK.md"), (idx_path, idx_text, "PLAYBOOK.index.json")):
            if not path.exists():
                problems.append("%s ausente" % label)
                continue
            got = path.read_text(encoding="utf-8-sig")
            if got != want:
                diverged = section_diff(got, want) if label == "PLAYBOOK.md" else ["(json)"]
                problems.append("%s divergente: %s" % (label, "; ".join(diverged[:8])))
        if problems:
            print("DRIFT DETECTADO (exit 2):")
            for p in problems:
                print("  - " + p)
            return 2
        print("FRESCO: projecao bate byte-a-byte com as fontes (%d regras, %d itens runbook)"
              % (len(data["rules"]), len(data["napkin"])))
        return 0

    if args.check_sent:
        if not idx_path.exists():
            print("PLAYBOOK.index.json ausente neste clone (exit 2)")
            return 2
        idx = json.loads(idx_path.read_text(encoding="utf-8-sig"))
        problems = []
        for row in idx.get("fontes", []):
            if not row.get("enviado"):
                continue
            path = repo / Path(row["caminho"])
            if not path.exists():
                problems.append("fonte enviada ausente: %s" % row["caminho"])
                continue
            if hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
                problems.append("sha256 divergente: %s" % row["caminho"])
        if revision_of(idx.get("fontes", []), only_sent=True) != idx.get("sent_revision"):
            problems.append("sent_revision divergente")
        if problems:
            print("CHECK-SENT FALHOU (exit 2):")
            for p in problems:
                print("  - " + p)
            return 2
        print("CHECK-SENT OK: %d fontes enviadas conferem" % sum(1 for r in idx.get("fontes", []) if r.get("enviado")))
        return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
