---
schema: dex.workflow.ppirtv.manutencao.config.v1
versao: 1
status: ativo
dono: dex-PPIRTV
fonte-viva: workflow/manutencao-iterativa-com-evidencia/SCHEMA/dex.workflow.ppirtv.manutencao.config.v1.schm.md
registro: tema schema-padrao (dex-memoria)
---

# Configuracao de manutencao PPIRTV

## Contrato

- Entradas: config.json fechado: schema, version, project_id, owner, graph(data_dir,database), measurement_roots, profile, receipt_root, contact(workspace_id,channel_id,thread_id).
- Caminhos: relativos ao repo; data dir existente .agents/CODE-REVIEW-GRAPH. Nunca apontar banco de outro projeto.
- Saidas: cada captura cria diretorio novo com raw metrics, graph, logs e receipt.json; nao sobrescreve.
- Criterios de pronto: ferramentas reais executadas, comandos/exit/hashes gravados, identidade do repo conferida; partial permanece partial.
- Dependencies: Python >=3.10, Node >=22, Git, CRG 2.3.7/schema9, exporter owner 1.2.0, medidor owner 0.4.2/v2; localizacao das skills por USERPROFILE/.agents/skills.
- Profile: dex.complexidade.profile.v1; CC-only; politica interpretativa no PERFIL-EXPERIMENTAL.md, sem thresholds inventados no medidor.
- Contato: dex.contact-resume.v1 pertence a skill dex-criar-workflow-contexto-atual; destino local em config. Executor_conversation_id e request_id pertencem a cada mensagem; nao reutilizar IDs antigos.

## Exemplo real

- config.json da instancia; execucao documentada em USAGE.md e receipts locais.

## Supersedes

- Nenhum schema de produto alterado. Nasce configuracao especifica da instancia; contrato generico do template e projecao em references, sem segunda fonte em SCHEMA.
