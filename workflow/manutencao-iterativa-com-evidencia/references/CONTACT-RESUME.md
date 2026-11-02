# Contato e retomada — dex.contact-resume.v1

- schema_id: dex.contact-resume.v1
- schema_version: 1
- Owner: dex-criar-workflow-contexto-atual.
- Requisito: Node >=22; skill instalada em `$env:USERPROFILE/.agents/skills/dex-criar-workflow-contexto-atual`.
- Comando de contrato: `node "$env:USERPROFILE/.agents/skills/dex-criar-workflow-contexto-atual/scripts/contact-resume.mjs" --schema`.
- Comando de validacao: `node "$env:USERPROFILE/.agents/skills/dex-criar-workflow-contexto-atual/scripts/contact-resume.mjs" --input .agents/receipts/manutencao-continua-20261102/contact-writer-request.json`.
- Destino owner: workspace T0B109A82SW, canal D0C5E5Y8MRT, thread 1793625886.184229; executor/request atuais por mensagem. Nao repetir envio historico.
- Campos obrigatorios: schema_id, schema_version, project_id, executor_conversation_id, request_id, reply_to_request_id (null ou string), channel_id, thread_id, sent_at_utc, response_required, poll_delays_seconds, poll_at_seconds, max_checks, timeout_seconds, question_or_dependency, authorized_nonblocking_action, expected_response, next_authorized_action.
- Valores: poll_delays_seconds=[30,60,60,60]; poll_at_seconds=[30,90,150,210]; max_checks=4; timeout_seconds=210.
- Envio: anunciar prazo; enviar uma vez em destino autorizado; guardar receipt e timestamp real. Resposta tem request_id proprio e reply_to_request_id do pedido.
- Leitura: consultar no cronograma; usar ultimo timestamp confirmado e cursor de paginacao; ler todas as paginas desde ele. Quatro leituras nao sao quatro mensagens nem quatro reenvios.
- Parada: resposta correlacionada e suficiente encerra imediatamente. Ausencia, insuficiencia e erro de transporte sao distintos. Informativo nao inicia polling.
- Timeout: guardar horarios reais; manter bloqueio dependente; continuar acao independente ja autorizada. Silencio nao aprova.
- Limites: checker valida envelope/simula relogio; nao envia, nao dorme, nao recebe nem roda daemon. Operador registra desvio de horario; nao promete monitoramento apos sessao.
- Proveniencia: protocolo validado em dois consumidores, com correcao de calendario e correlacao incorporadas ao owner. Nenhum dado de destino real pertence a este template.
