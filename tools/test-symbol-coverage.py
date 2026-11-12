#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Régua perene da rede símbolo×suíte (D-41, 2026-11-12; emendada pela adversarial).

Mede DUAS contagens por símbolo exportado dos módulos da maratona:
  - mention_refs: o nome aparece (word-boundary) em qualquer lugar de tests/*.test.ts;
  - code_refs:    o nome aparece em linha que NÃO é comentário (// ou bloco /* */).

Por que duas: a adversarial provou que 6 das 49 mentions eram prosa (comentário
ou título de it) — "mention" mede endereçabilidade por grep, "code" mede
referência de código. O relatório mostra as duas; o corte de rede decide pela
code_refs com o interrogador.

Rótulo honesto: "sem referência nominal" NÃO significa "sem cobertura" —
comportamento pode estar coberto via motor sem nomear o símbolo (ex.:
SPT_V3_EVIDENCE_STALE coberto em 2 arquivos sem citar
staleSelectedCriterionProofPaths). A calibração mora em
.agents/AUDITORIAS/2026-11-12-rede-simbolos-suporte/REDE.md.

Relatório, não gate: exit 0 no uso correto; exit 2 se a âncora não resolve
(src/ ou tests/ ausentes no root derivado de __file__ — cópia relocada deve
ABORTAR alto, nunca reportar 0/0 silencioso).
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Módulos da maratona (Ondas 1-7) — um por linha; adicione ao extrair onda nova.
# Nota: mining-policy foi absorvido pela memory-promotion (Onda 7 fecha as famílias).
MARATHON_MODULES = [
    "fiscal-blockers",
    "gate-resolution",
    "meeting-policy",
    "memory-promotion",
    "review-snapshot",
    "spt-traceability",
    "verdict-fiscal-policy",
    "verdict-learning",
]

# Emenda adversarial F2: type/interface/enum são exports top-level do contrato
# público — sem eles o denominador fica otimista (11 tipos perdidos no corte).
EXPORT_RE = re.compile(
    r"^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)",
    re.MULTILINE,
)

COMMENT_LINE_RE = re.compile(r"^\s*(//|/\*|\*)")


def strip_block_comments(text: str) -> str:
    """Remove blocos /* */ inteiros; comentários de linha são filtrados por linha."""
    return re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)


def module_exports(module_names: list[str]) -> dict[str, list[str]]:
    """Exports top-level de cada módulo (nome = nome de arquivo em src/)."""
    out: dict[str, list[str]] = {}
    for name in module_names:
        path = REPO_ROOT / "src" / f"{name}.ts"
        if not path.exists():
            out[name] = []
            continue
        # Emenda adversarial F3: src lê com errors=replace como o lado tests
        # (UnicodeDecodeError em cp1252 derrubava a régua com exit != 0).
        out[name] = sorted(set(EXPORT_RE.findall(path.read_text(encoding="utf-8", errors="replace"))))
    return out


def nominal_coverage(exports_by_module: dict[str, list[str]]) -> dict:
    """Por export: mention (word-boundary) e code (linha não-comentário) em tests/*.test.ts."""
    tests_dir = REPO_ROOT / "tests"
    mention_lines: list[str] = []
    code_lines: list[str] = []
    for p in sorted(tests_dir.glob("*.test.ts")):
        raw = p.read_text(encoding="utf-8", errors="replace")
        mention_lines.append(raw)
        code_lines.append(strip_block_comments(raw))
    mention_text = "\n".join(mention_lines)
    code_text = "\n".join(code_lines)

    def is_comment(line: str) -> bool:
        return bool(COMMENT_LINE_RE.match(line))

    report: dict = {"modules": {}, "total": {}}
    total_all = mention_all = code_all = 0
    prose_suspects: list[dict] = []
    for name, symbols in exports_by_module.items():
        mention = code = 0
        missing: list[str] = []
        suspects: list[str] = []
        for s in symbols:
            has_mention = bool(re.search(rf"\b{re.escape(s)}\b", mention_text))
            # code: alguma ocorrência em linha que não é comentário puro.
            has_code = any(
                re.search(rf"\b{re.escape(s)}\b", line)
                for line in code_text.splitlines()
                if not is_comment(line)
            ) if has_mention else False
            if has_mention:
                mention += 1
            if has_code:
                code += 1
            if not has_mention:
                missing.append(s)
            elif not has_code:
                suspects.append(s)
        report["modules"][name] = {
            "exports": len(symbols),
            "mention_refs": mention,
            "code_refs": code,
            "without_nominal_ref": missing,
            "prose_only_refs": suspects,
        }
        total_all += len(symbols)
        mention_all += mention
        code_all += code
        for s in suspects:
            prose_suspects.append({"module": name, "symbol": s})
    report["total"] = {
        "exports": total_all,
        "mention_refs": mention_all,
        "code_refs": code_all,
        "without_nominal_ref": total_all - mention_all,
    }
    report["prose_suspects"] = prose_suspects
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", metavar="PATH", help="escreve o relatório JSON neste caminho")
    args = parser.parse_args()

    # Emenda adversarial F4: cópia relocada (fora de <repo>/tools) deve abortar
    # ALTO — 0/0 exit 0 é falso-sucesso silencioso.
    src_dir = REPO_ROOT / "src"
    tests_dir = REPO_ROOT / "tests"
    if not src_dir.is_dir() or not tests_dir.is_dir():
        print(
            f"ERRO: âncora não resolve — {REPO_ROOT} não contém src/ e tests/.\n"
            "Isto NÃO é o repo: você provavelmente está executando uma CÓPIA relocada\n"
            "da régua. Fonte viva: <repo>/tools/test-symbol-coverage.py",
            file=sys.stderr,
        )
        return 2

    report = nominal_coverage(module_exports(MARATHON_MODULES))

    print(f"rede símbolo×suíte — referência nominal por módulo (root: {REPO_ROOT.name})")
    print(f"{'módulo':24s} {'code':>7s} {'mention':>9s} {'/exp':>6s}  sem-ref")
    for name, m in sorted(report["modules"].items()):
        if m["exports"] == 0:
            print(f"  {name:22s} (módulo ausente em src/ — confira a lista)")
            continue
        print(
            f"  {name:22s} {m['code_refs']:3d}/{m['exports']:<3d} {m['mention_refs']:5d}/{m['exports']:<3d}"
            f"        {len(m['without_nominal_ref'])}"
        )
    t = report["total"]
    print(
        f"  {'TOTAL':22s} {t['code_refs']:3d}/{t['exports']:<3d} {t['mention_refs']:5d}/{t['exports']:<3d}"
        f"        {t['without_nominal_ref']}"
    )
    print(
        f"  (code = linha não-comentário; mention = qualquer menção — prose_only: {len(report['prose_suspects'])}, ver JSON)"
    )

    if args.json:
        try:
            out_path = Path(args.json)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            print(f"JSON: {out_path}")
        except OSError as exc:
            # Emenda adversarial F3: --json não-gravável é AVISO, não crash —
            # a promessa exit-0 vale para o relatório, que já foi impresso.
            print(f"AVISO: não foi possível escrever {args.json}: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
