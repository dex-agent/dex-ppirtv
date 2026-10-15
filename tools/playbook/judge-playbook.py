#!/usr/bin/env python3
"""judge-playbook.py — juiz mecanico da prova cega V5 (design arena-zcode campeao).

Criterios (intersecao de conjuntos; eco do AGENTS.md nao casa):
  1. a resposta menciona PLAYBOOK.md;
  2. cita >=1 selo real do index (pb-<8hex>);
  3. cita >=1 localizador real do index;
  4. se a regra citada tem rotas, a resposta cita >=1 rota da regra.

Exit 0 = passou; exit 2 = falhou (criterios nao cumpridos acima).
"""

import argparse
import json
import re
import sys
from pathlib import Path


def norm(text):
    return " ".join(text.lower().replace("`", " ").replace("_", " ").split())


def main():
    ap = argparse.ArgumentParser(description="Juiz mecanico da prova cega do playbook")
    ap.add_argument("--answer", required=True, help="arquivo com a resposta do agente cego")
    ap.add_argument("--index", required=True, help="PLAYBOOK.index.json de referencia")
    args = ap.parse_args()

    answer_raw = Path(args.answer).read_text(encoding="utf-8-sig", errors="replace")
    answer = norm(answer_raw)
    index = json.loads(Path(args.index).read_text(encoding="utf-8-sig"))
    rules = index.get("rules", [])

    verdict = []
    failed = []

    ok_file = "playbook.md" in answer
    verdict.append("menciona PLAYBOOK.md: %s" % ("OK" if ok_file else "FALHOU"))
    if not ok_file:
        failed.append("resposta nao menciona PLAYBOOK.md")

    seals = {r["seal"]: r for r in rules}
    cited_seals = [s for s in seals if norm(s).replace("pb ", "pb-") in answer or s in answer_raw]
    ok_seal = bool(cited_seals)
    verdict.append("selo real citado: %s %s" % ("OK" if ok_seal else "FALHOU", cited_seals[:3]))
    if not ok_seal:
        failed.append("nenhum selo real do index citado (eco de AGENTS.md nao conta)")

    locators = {r["locator"]: r for r in rules}
    cited_loc = [loc for loc in locators if loc.lower() in answer_raw.lower()]
    ok_loc = bool(cited_loc)
    verdict.append("localizador real citado: %s %s" % ("OK" if ok_loc else "FALHOU", cited_loc[:3]))
    if not ok_loc:
        failed.append("nenhum localizador real do index citado")

    cited_rules = {}
    for s in cited_seals:
        cited_rules[seals[s]["seal"]] = seals[s]
    for loc in cited_loc:
        cited_rules[locators[loc]["seal"]] = locators[loc]
    ok_route = True
    for rule in cited_rules.values():
        rotas = [norm(r) for r in rule.get("rotas", [])]
        if rotas and not any(r in answer for r in rotas):
            ok_route = False
            verdict.append("rotas da regra %s: FALHOU (regra exige rota citada)" % rule["locator"])
    if not ok_route:
        failed.append("regra citada tem rotas e nenhuma foi citada")

    for line in verdict:
        print(line)
    if failed:
        print("VEREDITO: FALHOU (exit 2)")
        for f in failed:
            print("  - " + f)
        return 2
    print("VEREDITO: PASSOU (exit 0)")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
