#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Harness canônico de MUTAÇÃO DE AMOSTRA (promovido a tools/ no D-46; nasceu como
harness-v2.py no corte D-45 — 2º consumidor real paga a promoção, régua R17/MECANISMO-PAGA-O-CUSTO).
EMENDADO pela adversarial D-46 (R2): operação em BYTES (restauração byte-exata,
imune a CRLF/LF), TimeoutExpired vira INVALIDO com JSON (nunca crash seco),
vitest sem linha de resumo vira INVALIDO (nunca falso veredito), span tolera
tipo de retorno objetual (re-balance enquanto o span não contém `return`),
`export const` sem `;` aborta, e o JSON congela literal+mutacao (re-auditável).
CURADO no D-47 (incidente pago ao vivo): INVALIDO era SILENCIOSO — `return`
de guard dentro do try pulava o print/salva/exit que vinham APÓS o finally
(latente desde o D-45; forense por sys.settrace); agora o ciclo mora em
`_ciclo()` e o veredito é INCONDICIONAL. Emendas adversarial D-47 (R2):
fallback de span para FUNÇÃO INTERNA (`^function N` ancorado em linha);
função void/throw-only ganha o 1º span balanceado com flag
`span_heuristico` (o loop antigo inflava até a função seguinte); guard
anti-no-op (literal==mutação) e `viva_no_disco` obrigatório. Lições de
desenho de mutação: mutar MENSAGEM/valor (guarda de fluxo `if (false) throw`
mata narrowing → TS18048); mutação de VIGÍLIA precisa romper substring
(sufixo `_MUT` preserva prefixo e escapa de toThrow por substring).

4 VACINAS do incidente D-45 (10 falsos sobreviventes por str.replace sem match):
(1) LITERAL curto com count==1 em todo o arquivo + leitura viva do disco;
(2) VÍNCULO sítio↔símbolo: o literal deve cair DENTRO do span do símbolo;
(3) GUARD de compilação: `tsc --noEmit` sobre o mutante ANTES do veredito —
    mutante que não compila = run INVALIDO, nunca PEGA (nem SOBREVIVE);
(4) RESTAURAÇÃO byte-exata à prova de crash: try/finally com veredito de
    restauração gravado no JSON (crash nunca semeia mutante como BASE).

Veredito: `sobreviveu=true` (vitest exit 0) = LACUNA REAL (classe b) — it de
caracterização + re-mutação de vigília; `failed>0` = PEGA (coberta); erros de
guard = INVALIDO (nunca conta como cobertura).

CONTRATO DE EXIT: 0 = veredito VÁLIDO (leia o JSON — exit 0 NÃO significa
PEGA; distinga pelo campo `sobreviveu`) · 2 = INVALIDO/erro de guarda ·
1 = crash inesperado.

Limitações declaradas: `export const` cobre statement simples até o primeiro
`;` (objeto multi-linha não tem span; sem `;` o run aborta); genéricos
`f<T>`, generators `function*` e `export default` não são achados; o span de
função usa heurística "span que contém `return`" para pular o tipo de retorno
objetual — função sem `return` pode parar no primeiro span; baseline do
arquivo de teste DEVE estar verde antes (it vermelho pré-existente = falso
positivo de vigília — lição M8 do D-45); escopo é o arquivo de teste passado
(declará-lo por artefato).

Uso:
  python -B tools/mutacao-amostra.py \
    --src src/verdict-fiscal-policy.ts \
    --simbolo reportFiscalSignals \
    --literal 'if (condicao) {' \
    --mutacao 'if (condicao && false) {' \
    --teste 'tests/fiscal-recurrence.test.ts' \
    [--saida .agents/AUDITORIAS/<corte>/MUTACOES/M1.json]

Reuso: nenhum externo — stdlib (argparse/json/re/subprocess); invoca npx tsc/vitest
Perigo: MUTA o arquivo-alvo no disco durante o run (restauracao byte-exata em
  try/finally; conferir sha256 pre/pos lote; mutante que quebra tsc = INVALIDO)
Custo: R17 pago no D-46 (promocao do harness-v2 com 2o consumidor real; 9 runs
  congelados em .agents/AUDITORIAS/2026-11-13-rede-verdict-fiscal-policy/MUTACOES/)
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def balancear(base: bytes, inicio_chave: int):
    """Devolve (fim, prof_zero_em) balanceando {} a partir da chave em inicio_chave."""
    prof, i = 1, inicio_chave + 1
    while prof > 0 and i < len(base):
        c = base[i:i+1]
        prof += (c == b"{") - (c == b"}")
        i += 1
    return i, prof == 0


def span_simbolo(base: bytes, nome: str):
    """Span (inicio, fim) em BYTES do símbolo exportado; None se não achado.

    Função: regex casa até o `)` da assinatura, depois a PRIMEIRA `{`; se o
    span balanceado não contém `return` (era o tipo de retorno objetual),
    tenta a PRÓXIMA `{` (heurística do corpo). Const: até o primeiro `;`
    (sem `;` = span indefinido → erro).
    """
    m = re.search(rb"export (?:async )?function " + re.escape(nome).encode() + rb"\([^)]*\)", base)
    if not m:
        # Extensão D-47 (R17, 3º consumidor): fallback para FUNÇÃO INTERNA do
        # módulo (evaluateExpectation/staleRevisionPaths são alvos legítimos de
        # rede mas não são exportadas); export vence quando ambos existem.
        m = re.search(rb"(?m)^(?:async )?function " + re.escape(nome).encode() + rb"\([^)]*\)", base)
    if m:
        cursor = m.end()
        primeiro_span = None
        for _ in range(8):  # no máximo 8 tentativas de re-balance
            chave = base.find(b"{", cursor)
            if chave == -1:
                break
            fim, fechou = balancear(base, chave)
            if not fechou:
                break
            span = (m.start(), fim)
            if primeiro_span is None:
                primeiro_span = span
            if re.search(rb"\breturn\b", base[m.start():fim]):
                return span[0], span[1], False
            cursor = fim
        # Emenda adversarial D-47/R2-P2-1: função void/throw-only NÃO contém
        # return — o loop antigo inflava o span até a função SEGUINTE. Fallback:
        # o PRIMEIRO span balanceado com flag span_heuristico (proveniência
        # declarada no JSON; veredito continua decidido por tsc/vitest).
        if primeiro_span is not None:
            return primeiro_span[0], primeiro_span[1], True
        return None
    m = re.search(rb"export const " + re.escape(nome).encode() + rb"\b", base)
    if m:
        j = base.find(b";", m.end())
        if j == -1:
            return ("SEM_PONTO_E_VIRGULA",)
        return m.start(), j + 1, False
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Mutação de amostra com as 4 vacinas do D-45 (emenda adversarial D-46)")
    ap.add_argument("--src", required=True, help="arquivo TypeScript alvo (relativo à raiz do repo)")
    ap.add_argument("--simbolo", required=True, help="nome do símbolo exportado dono do literal")
    ap.add_argument("--literal", required=True, help="literal EXATO a substituir (count==1 no arquivo)")
    ap.add_argument("--mutacao", required=True, help="texto mutado que substitui o literal")
    ap.add_argument("--teste", required=True, help="arquivo(s) de teste vitest (string única, espaços separem)")
    ap.add_argument("--saida", default=None, help="caminho .json para congelar o veredito (opcional)")
    args = ap.parse_args()

    src = (ROOT / args.src).resolve()
    resultado = {
        "src": args.src,
        "simbolo": args.simbolo,
        "literal": args.literal,
        "mutacao": args.mutacao,
        "teste": args.teste,
        "valido": False,
        "restaurado": False,
    }
    lit_b = args.literal.encode("utf-8")
    mut_b = args.mutacao.encode("utf-8")
    base = src.read_bytes()

    def _ciclo() -> None:
        """Ciclo muta→tsc→vitest. Guards só SAEM do ciclo (return daqui) — o
        print/salva/exit do main são INCONDICIONAIS (cura D-47: INVALIDO
        silencioso com exit 0 — return de guard pulava tudo que vinha depois
        do try/finally; latente desde o harness-v2 do D-45, 1º disparo real
        no D-47 com o mutante TS18048)."""
        span = span_simbolo(base, args.simbolo)
        if not span:
            resultado["erro"] = "simbolo nao achado"
            return
        if span == ("SEM_PONTO_E_VIRGULA",):
            resultado["erro"] = "export const sem ; - span indefinido (abort)"
            return
        n = base.count(lit_b)
        if n != 1:
            resultado["erro"] = "literal count=%d (exige count==1)" % n
            return
        pos = base.find(lit_b)
        resultado["linha"] = base[:pos].count(b"\n") + 1
        if not (span[0] <= pos < span[1]):
            resultado["erro"] = "literal FORA do span do simbolo (linha %d)" % resultado["linha"]
            return
        if lit_b == mut_b:
            resultado["erro"] = "mutacao identica ao literal (no-op) - run INVALIDO"
            return
        src.write_bytes(base.replace(lit_b, mut_b, 1))
        resultado["viva_no_disco"] = src.read_bytes().count(mut_b) == 1
        if not resultado["viva_no_disco"]:
            resultado["erro"] = "mutacao nao viva no disco - run INVALIDO"
            return
        if span[2]:
            resultado["span_heuristico"] = True
        try:
            tsc = subprocess.run(
                "npx tsc --noEmit -p tsconfig.json",
                shell=True, capture_output=True, text=True, timeout=600, cwd=str(ROOT),
            )
        except subprocess.TimeoutExpired:
            resultado["erro"] = "timeout tsc - run INVALIDO"
            return
        if tsc.returncode != 0:
            resultado["erro"] = "mutante quebra compilacao - run INVALIDO (vacina 3)"
            return
        try:
            proc = subprocess.run(
                "npx vitest run " + args.teste,
                shell=True, capture_output=True, text=True, timeout=1200, cwd=str(ROOT),
            )
        except subprocess.TimeoutExpired:
            resultado["erro"] = "timeout vitest - run INVALIDO"
            return
        out = re.sub(r"\x1b\[[0-9;]*m", "", proc.stdout + proc.stderr)
        m = re.search(r"Tests\s+(?:(\d+)\s+failed\s*\|)?\s*(\d+)\s+passed", out)
        if m is None:
            resultado["erro"] = "vitest sem linha de resumo (crash?) - run INVALIDO"
            return
        resultado["vitest_saida"] = out[-20000:]  # cauda sanitizada p/ citar its que pegaram
        resultado.update({
            "valido": True,
            "failed": int(m.group(1) or 0),
            "passed": int(m.group(2)),
            "sobreviveu": proc.returncode == 0,
        })

    try:
        _ciclo()
    finally:
        try:
            src.write_bytes(base)
            resultado["restaurado"] = src.read_bytes() == base
        except Exception as e:  # pragma: no cover - defesa de crash
            resultado["restaurado"] = "ERRO: %s" % e
    print(json.dumps({k: v for k, v in resultado.items() if k != "vitest_saida"}, ensure_ascii=False))
    if args.saida:
        Path(args.saida).parent.mkdir(parents=True, exist_ok=True)
        Path(args.saida).write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    sys.exit(0 if resultado.get("valido") else 2)


if __name__ == "__main__":
    main()
