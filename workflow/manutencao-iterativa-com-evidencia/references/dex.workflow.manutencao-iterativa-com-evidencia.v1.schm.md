---
schema: dex.workflow.manutencao-iterativa-com-evidencia.v1
versao: 1.1
status: projecao
dono: template global manutencao-iterativa-com-evidencia
fonte-viva: ~/.agents/workflow/manutencao-iterativa-com-evidencia/SCHEMA/dex.workflow.manutencao-iterativa-com-evidencia.v1.schm.md
registro: projecao da fonte global; nao e fonte dona local
nascimento: 2026-10-31
---

# Schema dex.workflow.manutencao-iterativa-com-evidencia.v1

## Contrato

- Entradas: repo e bloco-alvo; comportamento esperado; owner; testes/casos; busca de abstrações/consumidores; capacidades selecionadas; perfil opcional; provider e snapshots antes/depois quando existentes; proveniência de revisão, índice e working tree; divergências de dados entre DB, receipt, MCP e CLI.
- Saídas: mudança coesa; testes e resultados antes/depois; registro de busca e decisão reutilizar/adaptar/criar; medições brutas e perfil separados; snapshots/diff ou estado explícito não medido; discrepâncias preservadas por fonte; pendências com owner e quando.
- Critérios de pronto: comportamento requerido testado; refatoração preserva comportamento e foi retestada; busca/decisão e proveniência registradas; capacidades ausentes permanecem explícitas; limitações e pendências honestas; revisão do owner concluída. Evolução de workflow mantém linhagem/adaptações locais e só promove melhoria com evidência, generalização, compatibilidade, revisão, validação e versionamento; atualiza a instância por merge consciente com rollback.

## Exemplo real

- Fonte: exemplos executados em [USAGE.md](../USAGE.md).

## Configuracao da instancia

- Arquivo CONFIG: JSON local da execucao; graph.database aponta banco existente do mesmo repo; graph.data_dir aponta o data dir governado. Caminhos sao preenchidos somente na instancia.
- Perfil do medidor: contrato dex.complexidade.profile.v1 da skill owner; thresholds.cc.max_per_function e observacional. Politica interpretativa, cobertura e nesting nao sao campos extras desse perfil.
- Contato: dex.contact-resume.v1 da skill workflow owner; destinos e executor somente na instancia/envelope, nunca no template.

## Supersedes

- Contrato inline anterior em `SCHEMA/SCHEMA.md`; formaliza o mesmo escopo como schema identificável, sem alteração de comportamento.
