# SCHEMA — Porta de entrada

- Schema especifico local: [dex.workflow.ppirtv.manutencao.config.v1](dex.workflow.ppirtv.manutencao.config.v1.schm.md).
- Contrato generico herdado: projecao em references/dex.workflow.manutencao-iterativa-com-evidencia.v1.schm.md; fonte dona permanece no template global.
- Schema base do pacote: `dex.workflow.v1`, cuja fonte viva pertence à skill `dex-criar-workflow-contexto-atual`; não copiar a fonte para este pacote.
- Schemas adicionais: cada um usa nome do schema com extensao .schm.md; aplicar padrao-schema-casa-v3 da skill check-schemas. Schema transversal mora na skill owner; projecao necessaria ao cold-start fica em references, nunca como segunda fonte em SCHEMA.
- Contato: consumir dex.contact-resume.v1 da skill dex-criar-workflow-contexto-atual; regras operacionais no references/CONTACT-RESUME.md do pacote.

## Contrato

- Entradas: config.json, perfil CC-only, codigo autoral, banco existente do PPIRTV e corte autorizado.
- Saidas: receipt create-only com raw/log/graph/hashes; decisao de reuso, testes e pendencias no USAGE.
- Criterios de pronto: comandos reais executados com resultados pertinentes; limites preservados; revisao local do diff. Publicacao e operacoes fiscais fora do escopo.


method_contract: dex.workflow.v1 rev 1.4

## Metodos concorrentes

- action_family: familia da acao/resultado
- method_id: identificador e versao do metodo
- scope: limites de aplicabilidade
- responsibilities: owners e responsabilidades
- differential_hypothesis: ganho/risco que diferencia o metodo
- inputs: entradas
- outputs: saidas
- applicability: condicoes de uso
- comparator: candidato comparador, ou nenhum identificado no escopo pesquisado
- comparability: criterios que tornam observacoes comparaveis
- reuse_potential: potencial ainda nao observado
- reuse_observed: uso/evidencia observados
- initial_investment: custo inicial separado
- recurring_maintenance: custo recorrente separado
- selection_state: candidate | not_elected | standard | reverted
- criteria: criterios previamente declarados
- owner_decision: decisao explicita do owner
- decision_evidence: localizadores verificaveis
- reversal: plano para retirar ou reverter o padrao

Eleicao de `standard` exige evidencias reais em pelo menos duas oportunidades comparaveis ao longo do tempo. Revisao humana confirma significado e veracidade.
