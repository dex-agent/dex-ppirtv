# SPRINTS

## Sprint 0 - Contrato documental

Goal: transformar a ideia do PPIRTV em especificacao rastreavel.

Backlog:

- Criar glossario.
- Criar SPEC/PLAN/TASKS.
- Criar guias numerados.
- Criar ADRs.
- Registrar fontes MCP.

Definition of Done:

- Documentos existem.
- Termos principais estao definidos.
- Tools/resources/prompts estao propostos.
- Lacunas estao marcadas como `A confirmar`.

Riscos:

- Confundir metodo operacional com implementacao.
- Criar docs bonitas mas sem criterios de pronto.

Fora do corte:

- Codigo do servidor MCP.

## Sprint 1 - Servidor MCP minimo

Goal: provar que o harness aparece para um cliente MCP.

Backlog:

- Escolher stack.
- Criar servidor `stdio`.
- Expor capabilities.
- Expor tool minima.

Definition of Done:

- [x] Cliente lista tools/resources/prompts.
- [x] Teste smoke passa.
- [x] Erros de inicializacao sao legiveis.

## Sprint 2 - Estado explicito

Goal: criar e recuperar flows por `flow_id`.

Backlog:

- Schema de flow.
- Ledger local.
- Tools de criar, consultar e arquivar.

Definition of Done:

- [x] Flow sobrevive a restart.
- [x] Nenhuma tool depende de estado implicito por conexao.

## Sprint 3 - Gates e retornos

Goal: impedir avanco por entusiasmo.

Backlog:

- Gates por fase.
- Avanco controlado.
- Retorno com motivo.

Definition of Done:

- [x] Avanco sem gate falha com mensagem acionavel.
- [x] Retorno registra fase anterior, motivo e evidencia.

## Sprint 4 - Reunioes

Goal: padronizar divergencia, convergencia e transversalidade.

Backlog:

- Templates de reuniao.
- Tools de abertura e registro.
- Vinculo com decisoes.

Definition of Done:

- [x] Uma decisao importante tem origem rastreavel em reuniao.

## Sprint 5 - Evidencia e veredito

Goal: concluir ciclos com prova.

Backlog:

- Evidencias.
- Checklist visual.
- Veredito.
- Higiene.

Definition of Done:

- [x] Um flow completo termina com veredito e riscos residuais.

## Sprint 6 - Uso real

Goal: usar o harness em um trabalho real de projeto.

Backlog:

- Integrar cliente MCP alvo.
- Executar flow de exemplo.
- Publicar docs de instalacao.

Definition of Done:

- [x] Outro agente consegue seguir o README e rodar o harness.

## Evidencia do MVP

- `npm run check`: 17 testes passaram.
- Cobertura executada: engine, persistencia/restart, gates, retorno, reunioes,
  evidencia, veredito, higiene, principios operacionais e MCP `stdio` com
  cliente real.
