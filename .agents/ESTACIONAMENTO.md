# Estacionamento

## Relatorio de retomada

- atualizado em: 2026-05-15 10:23 America/Sao_Paulo
- origem: implementacao do harness MCP PPIRTV
- estado: ativa
- proximo uso recomendado: sprinter

## Ativos

- [EST-01] [alerta] o MCP precisa capturar estacionamento/garimpo sem inflar contrato com tools novas fora da SPEC
  - origem: pedido do usuario durante revisao/construcao
  - motivo de estacionamento: conceito transversal importante para especialistas, mas tool dedicada ainda seria aumento de contrato
  - garimpo vinculado: heuristica pratica - encaixe primeiro em artefatos existentes e ledger; tool dedicada so depois de SPEC/ADR/TASKS
  - sinal de destino: sprint

- [EST-02] [governanca] especialistas e indice rapido tem caminhos canonicos globais
  - origem: instrucao do usuario durante validacao
  - motivo de estacionamento: regra operacional importante para futuras integracoes do harness com especialistas
  - garimpo vinculado: dica de ouro - registrar caminhos como variaveis de ambiente, nao hardcode de usuario nem copia local de skills
  - sinal de destino: artefato

## Resolvidos/descartados recentes

- [EST-00] [concluido] gate do runbook reavaliava sem reaproveitar gate persistido

## Prontos para sprint

- [EST-01] Avaliar no proximo ciclo se `parking_lot` e `gold_mining` merecem tools dedicadas.
- [EST-02] Avaliar integracao futura do MCP com leitura da governanca global de skills.

## Itens que ainda dependem de decisao

- [EST-01] Decidir se estacionamento/garimpo seguem como campos transversais ou viram contrato MCP proprio.
- [EST-02] Decidir se o harness deve expor resource futuro para governanca de especialistas.
