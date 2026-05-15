# Contexto do Dominio

Este arquivo e o glossario vivo do projeto. Ele deve explicar termos do dominio,
sem virar especificacao tecnica nem plano de implementacao.

## Termos

### PPIRTV

Metodo de fluxo de trabalho em seis fases:

1. Pensamentos
2. Planejamento
3. Implementacao
4. Revisao
5. Teste
6. Validacao

### Harness

Estrutura operacional que guia um agente, humano ou automacao por um processo
com fases, gates, criterios de entrada, criterios de saida e evidencias.

### Flow

Instancia viva de um ciclo PPIRTV. Um flow possui objetivo, fase atual, historico
de transicoes, gates, riscos, decisoes e evidencias.

### Gate

Verificacao obrigatoria antes de avancar para outra fase. Um gate pode bloquear,
aprovar, aprovar com ressalvas ou devolver o flow para fase anterior.

### Retorno

Movimento controlado para uma fase anterior quando um gate falha, uma regressao
aparece ou uma premissa se mostra errada.

### Reuniao divergente

Modo de trabalho para abrir possibilidades, levantar riscos, perguntas, "e se?"
e alternativas antes de escolher um caminho.

### Reuniao convergente

Modo de trabalho para fechar decisao, reduzir escopo, escolher trilho e definir
criterio de pronto.

### Reuniao transversal

Modo de trabalho para atravessar fronteiras entre areas, por exemplo arquitetura,
seguranca, UX, testes, documentacao e operacao.

### Evidencia

Artefato verificavel que sustenta uma afirmacao. Pode ser log, teste, screenshot,
diff, link, checklist, nota de reuniao ou resultado estruturado de tool.

### Veredito

Decisao final de uma etapa ou entrega: `pronto`, `pronto_com_ressalvas`,
`nao_pronto` ou `bloqueado`.

### Casa limpa

Principio operacional: o trabalho nao deve apenas funcionar; deve deixar codigo,
documentos, tarefas, logs e decisoes em lugar claro, sem lixo obvio ou caminhos
mortos.

### Barata nunca esta sozinha

Principio de investigacao: ao encontrar um bug, path fixo, regra duplicada ou
residuo, procurar ao redor por ocorrencias semelhantes antes de concluir.

