# Perfil experimental PPIRTV v1

- Version: 1.0.0
- Autoridade: pedido explicito do owner em 2026-11-02; mesma regua Hub v1, sem herdar configuracao Amaze.
- Escopo inicial: src/mcp e scripts proprios deste pacote; expandir somente com corte autoral declarado.
- Natureza: metas de refatoracao continua; observacional. CC inicial alta nao reprova entrega. Sem payback imediato obrigatorio.

| Dimensao | Meta | Alerta | Revisao | Fonte/limite |
|---|---|---|---|---|
| CC por funcao | <=5 | 6..10 | >10 | medidor 0.4.2; profile CC-only max_per_function=5 |
| Aninhamento | <=2 | 3 | >=4 | js_ts_nesting v2 opt-in; limites fora do profile |
| Linhas novas/alteradas cobertas | 90% | abaixo da meta | revisar contexto | somente medicao confiavel; ausente=nao medido |
| Branches novas/alteradas cobertas | 80% | abaixo da meta | revisar contexto | somente medicao confiavel; ausente=nao medido |
| Testes relevantes | todos passam | falhas/skips separados | corrigir regressao | teste passando nao comprova 90/80 |
| Ciclos novos | zero | comparar somente provider valido | revisar ciclo real | exporter nao reporta ciclos; nao medido |

- Perfil executavel: profile-cc-v1.json usa somente dex.complexidade.profile.v1. Capability deve coincidir com chamada. Nesting e snapshot diff sao chamadas separadas sem profile CC-only.
- Dados faltantes: partial, null, not_applicable, function_not_found e unsupported nao sao zero. Maximo observado nao cobre funcoes parciais.
- Reuso: buscar codigo e CRG antes de abstrair; dois consumidores independentes comprovam reuso observado. Helper de uso unico pode separar responsabilidade com contrato justificavel. Nao contar chamadas repetidas como consumidores distintos.
- Conjunto: guardar CC por funcao, soma/maximo incluindo helpers, dependencias, modulos tocados, esforco observado e regressoes. CC local menor nao prova ganho global; mais funcoes/custo inicial nao sao veto.
- Baseline: receipts manutencao-continua-20261102; 4 funcoes src/mcp, CC total21/max17, status partial. Fotografia inicial nao e promessa de melhoria.
- Quando reavaliar: baseline e dois cortes uteis de codigo comparaveis; cortes documentais/de implantacao nao substituem evidencia longitudinal de manutencao de produto.
