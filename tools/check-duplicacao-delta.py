#!/usr/bin/env python3
"""check-duplicacao-delta.py — gate de commit anti-duplicacao Type-2 (dex-PPIRTV).

Reuso: consome o motor vivo medir-duplicacao.py da skill global
dex-complexidade-ciclomatica (schema dex.duplicacao.v1) — este gate NAO mede
nada sozinho (R6/R16: deteccao deterministica por hash de AST normalizada;
nunca regex/heuristica). Instalado como 5o gate do tools/playbook/hooks/pre-commit.

Perigo: sintatico so — Type-4 (mesma funcao escrita diferente) e conceptual
(mesmo conhecimento) NAO sao pegos aqui; seguem na revisao (por desenho, ver
skill dex-duplicacao-codigo). So .py (R13: normalizar token por regex em outra
linguagem e o falso-positivo proibido). test_* ficam fora (default do motor).

Custo (R17, medido 2026-11-14 no repo atual: 6 arquivos .py / 31 funcoes):
0.274s por commit com .py staged (1 subprocess no motor). Repo crescer =
re-medir e declarar aqui.

Regra do gate: grupo Type-2 ENTRE arquivos (exatas_entre_arquivos do motor)
com qualquer membro em arquivo .py STAGED = exit 1 com as DUAS localizacoes
(arquivo:linha nome), salvo par na tools/duplicacao-allowlist.json (R10 —
excecao versionada com motivo, nunca na cabeca de quem commita).

Exit codes: 0 = passou / nada a fiscalizar / aviso P10 (motor ausente);
1 = duplicata bloqueada OU motor doente (falha fechada com acao, nunca silencio);
2 = uso invalido.
"""
import argparse
import json
import os
import subprocess
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOTOR = os.path.join(
    os.environ.get("USERPROFILE", os.path.expanduser("~")),
    ".agents", "skills", "dex-complexidade-ciclomatica", "scripts",
    "medir-duplicacao.py",
)
ALLOWLIST = os.path.join(REPO_ROOT, "tools", "duplicacao-allowlist.json")

USAGE = """check-duplicacao-delta — gate de commit anti-duplicacao Type-2

USO
  python tools/check-duplicacao-delta.py --check     # modo hook (fiscaliza staged)
  python tools/check-duplicacao-delta.py --report    # lista grupos envolvendo staged
  python tools/check-duplicacao-delta.py --check --json   # veredito maquina

RECEITAS
  # prova manual antes de commitar .py
  python tools/check-duplicacao-delta.py --check

  # variante legitima? pare na allowlist COM motivo (R10) — chave por BASENAME
  # tools/duplicacao-allowlist.json: {"a": "x.py:funcao",
  #  "b": "y.py:funcao_irma", "motivo": "...", "desde": "2026-11-14"}

LEITURA
  exit 0  passou / sem .py staged / motor ausente (aviso P10, frota)
  exit 1  duplicata Type-2 entre arquivos com membro staged (ou motor doente)
  exit 2  uso invalido

ERROS COMUNS
  - O gate barra grupo PRE-EXISTENTE tocado pelo commit: e por desenho — o
    commit mantem a duplicata; consolide ou allowliste com motivo.
  - Motor ausente na frota: aviso amarra (P10) — instalar a skill
    dex-complexidade-ciclomatica devolve o gate cheio.
"""

SCHEMA = {
    "pacote": "dex-PPIRTV/tools/check-duplicacao-delta",
    "versao": "1.0.0",
    "missao": "barrar commit que introduz/mantem duplicata Type-2 entre arquivos .py",
    "motor": "dex.duplicacao.v1 (medir-duplicacao.py, skill dex-complexidade-ciclomatica)",
    "regra": {
        "red": "exatas_entre_arquivos[].membros com membro em .py staged e o par fora da allowlist",
        "green": "sem grupos envolvendo staged, ou todo par (staged, outro) allowlistado",
    },
    "allowlist": {
        "arquivo": "tools/duplicacao-allowlist.json",
        "schema": "dex.duplicacao.allowlist.v1",
        "chave_do_par": "arquivo:nome (normalizada por ordenacao a,b)",
    },
    "saida_check": {
        "ok": "boolean", "bloqueado": "boolean", "grupos_staged": "integer",
        "achados": "string[] no formato 'arquivo:linha nome <-> arquivo:linha nome'",
        "aviso": "string (vazio quando sem aviso)",
    },
    "exit": {"0": "passou/aviso", "1": "bloqueado/motor doente", "2": "uso invalido"},
}


def _git(args):
    r = subprocess.run(["git", "-C", REPO_ROOT] + args,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"ERRO git {args}: {r.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return [l.strip() for l in r.stdout.splitlines() if l.strip()]


def _norm(path):
    return path.replace("\\", "/").lstrip("./")


def _par_key(a, b):
    return tuple(sorted([a, b]))


def carregar_allowlist():
    if not os.path.isfile(ALLOWLIST):
        return set()
    try:
        dados = json.load(open(ALLOWLIST, encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERRO allowlist ilegivel ({ALLOWLIST}): {exc} — corrija o JSON antes de commitar", file=sys.stderr)
        sys.exit(1)
    pares = set()
    for item in dados.get("pares", []):
        a, b = item.get("a", ""), item.get("b", "")
        if not a or not b or not item.get("motivo"):
            print(f"ERRO allowlist: par sem a/b/motivo ({item}) — R10 exige motivo", file=sys.stderr)
            sys.exit(1)
        pares.add(_par_key(a, b))
    return pares


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--help", action="store_true")
    ap.add_argument("--usage", action="store_true")
    ap.add_argument("--schema", action="store_true")
    args = ap.parse_args()

    if args.help or not (args.check or args.report or args.usage or args.schema):
        print(__doc__)
        return 0
    if args.usage:
        print(USAGE)
        return 0
    if args.schema:
        print(json.dumps(SCHEMA, indent=1, ensure_ascii=False))
        return 0

    t0 = time.perf_counter()
    staged = {_norm(p) for p in _git(["diff", "--cached", "--name-only", "--", "*.py"])}
    # o motor reporta arquivos por BASENAME (exatas_entre_arquivos[].membros[].arquivo
    # = "mutacao-amostra.py", sem dir) — casar por basename, nunca por path completo
    staged_base = {os.path.basename(p) for p in staged}
    resultado = {
        "ok": True, "bloqueado": False, "grupos_staged": 0,
        "achados": [], "aviso": "", "staged_py": sorted(staged),
        "segundos": 0.0,
    }
    if not staged:
        resultado["aviso"] = "sem .py staged — nada a fiscalizar"
        if args.check and not args.json:
            print("DUPLICACAO-DELTA: ok (sem .py staged)")
        return _sair(resultado, args, t0)

    if not os.path.isfile(MOTOR):
        resultado["aviso"] = (
            "DUPLICACAO-DELTA (aviso P10): motor ausente ("
            f"{MOTOR}) — gate pulado; instale a skill dex-complexidade-ciclomatica"
        )
        return _sair(resultado, args, t0)

    alvos = sorted({_norm(p) for p in _git(["ls-files", "*.py"])} | staged)
    r = subprocess.run(
        [sys.executable, "-B", MOTOR] + alvos + ["--json"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=REPO_ROOT,
    )
    try:
        dados = json.loads(r.stdout)
    except ValueError:
        print(
            "DUPLICACAO-DELTA: motor doente (stdout nao-JSON, exit "
            f"{r.returncode}) — ACAO: rode o motor manualmente e corrija antes de commitar.\n"
            f"stderr: {r.stderr.strip()[:400]}",
            file=sys.stderr,
        )
        return 1
    if r.returncode not in (0,):
        print(
            f"DUPLICACAO-DELTA: motor reportou exit {r.returncode} — ACAO: veja a saida acima.\n"
            f"stderr: {r.stderr.strip()[:400]}",
            file=sys.stderr,
        )
        return 1

    allow = carregar_allowlist()
    achados, allowlisted = [], []
    for grupo in dados.get("exatas_entre_arquivos", []):
        membros = [{**m, "arquivo": os.path.basename(_norm(m["arquivo"]))} for m in grupo.get("membros", [])]
        tocados = [m for m in membros if m["arquivo"] in staged_base]
        if not tocados:
            continue
        resultado["grupos_staged"] += 1
        for t in tocados:
            for outro in membros:
                if outro is t or outro["arquivo"] == t["arquivo"]:
                    continue
                chave = _par_key(f"{t['arquivo']}:{t['nome']}", f"{outro['arquivo']}:{outro['nome']}")
                linha = (f"{t['arquivo']}:{t['linha']} {t['nome']} <-> "
                         f"{outro['arquivo']}:{outro['linha']} {outro['nome']} "
                         f"(corpo Type-2 igual, {grupo.get('linhas', '?')} linhas)")
                if chave in allow:
                    allowlisted.append(linha + " [allowlist]")
                else:
                    achados.append(linha)

    if achados:
        resultado["ok"] = False
        resultado["bloqueado"] = True
        resultado["achados"] = achados
        if not args.json:
            print("DUPLICACAO-DELTA: BLOQUEADO — duplicata Type-2 entre arquivos tocada por este commit:")
            for a in achados:
                print(f"  {a}")
            print("  ACAO: consolide na funcao existente, OU pare o par em tools/duplicacao-allowlist.json com motivo (R10).")
    elif allowlisted and not args.json:
        print("DUPLICACAO-DELTA: ok (grupos staged todos allowlistados):")
        for a in allowlisted:
            print(f"  {a}")
    elif args.check and not args.json:
        print(f"DUPLICACAO-DELTA: ok ({len(staged)} .py staged fiscalizado(s), "
              f"{resultado['grupos_staged']} grupo(s) envolvendo staged)")
    return _sair(resultado, args, t0)


def _sair(resultado, args, t0):
    resultado["segundos"] = round(time.perf_counter() - t0, 3)
    if args.json:
        print(json.dumps(resultado, ensure_ascii=False, indent=1))
    elif not resultado["bloqueado"] and resultado["aviso"] and args.check:
        print(resultado["aviso"])
    return 1 if resultado["bloqueado"] else 0


if __name__ == "__main__":
    sys.exit(main())
