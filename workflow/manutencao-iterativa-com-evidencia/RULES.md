# RULES - manutencao-iterativa-com-evidencia

## Regras

- R1: o alvo é um bloco de mudança com comportamento e owner identificados.
- R2: procure abstrações e consumidores existentes antes de criar uma; registre escopo, termos, candidatos e decisão.
- R3: semântica e contrato decidem compatibilidade; similaridade de texto não prova reuso correto.
- R4: reuso potencial é intenção; reuso efetivo exige evidência separada, sem requisito universal de múltiplos consumidores atuais.
- R5: preserve medições brutas separadas de perfil e de gates; capacidade disponível não significa ativada.
- R6: nenhum valor ausente, parcial ou não aplicável vira zero ou aprovação.
- R7: faça testes antes/durante quando cabível; após a implementação, teste comportamento, refatore preservando-o e reteste.
- R8: entrega rápida e arquitetura durável se complementam; o primeiro funcionamento não encerra a refatoração.
- R9: thresholds ilustrativos não são limites aprovados nem gates do workflow.
- R10: grafo existente guia leitura e testes; não prova semântica, equivalência, completude ou dependência dinâmica.
- R11: compare snapshots somente sob contratos de extração, escopo, versão/schema e normalização compatíveis; não fabrique baseline.
- R12: descubra hooks Git existentes; não instale nem altere hooks globais por este workflow.
- R13: registre proveniência, resultados, exceções e pendências; não reivindique benefício futuro sem evidência longitudinal.
- R14: preserve diferenças entre receipts, SQLite, MCP e CLI como leituras distintas até o owner do provider explicar a causa.
- R15: preserve arestas e endpoints unresolved; completude ausente não autoriza descarte ou imputação.
- R16: instância local é editável; diferenças locais são adaptações até prova de drift inválido segundo um contrato explicitamente adotado.
- R17: promoção local→global exige evidência de melhoria real, análise de generalização, retirada de hardcodes, compatibilidade/schema, revisão, validação, versionamento e changelog.
- R18: atualizar template global nunca sobrescreve personalização local em silêncio; faça proposta de merge/migração consciente, preserve histórico e rollback e não sincronize automaticamente.
- R19: mantenha particularidades no workflow local; não promova dados, IDs, rotas, cadências ou decisões específicas como regra universal.

## Limites

- Esta instancia usa politica experimental PPIRTV v1 do pedido; nao muda thresholds globais nem gates fiscais.
- O workflow orquestra consumo do provider e exporter da skill code-review-graph; nao implementa outro exporter ou medidor.
- O workflow não substitui Trilho/SPT, revisão do owner, segurança, testes obrigatórios ou aprovação de policy.
- O workflow não mede coesão ou responsabilidade semântica por um contador universal.
- O workflow não decide se uma abstração é boa apenas por CC, quantidade de consumidores ou similarity.
- Exporter canonico faz projecao read-only schema9; nao garante completude, ciclos ou atomicidade entre Git, fontes e banco.
- Fluxo global→local não é sincronização automática; linhagem informa origem, enquanto customizações e decisões pertencem à instância.

- R20: leia as regras comuns do ecossistema antes das regras do pacote; para a mesma acao, preserve candidatos e so promova padrao com evidencia real comparavel, criterio, decisao do owner e reversao rastreavel.
- R21: contato requerido usa dex.contact-resume.v1; prazo 210s, leituras incrementais 30/90/150/210, sem reenvio; resposta suficiente usa reply_to_request_id; informativo nao inicia espera.
- R22: fontes compartilhadas exigem writer check, backup e comparacao de hashes antes de escrever; conflito suspende somente a escrita dependente.
- R23: medir conjunto afetado incluindo helpers e distinguir consumidores independentes de chamadas; nenhum payback imediato e exigido.
