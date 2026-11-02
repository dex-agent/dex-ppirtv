# Portabilidade e adocao seletiva

Origem-adicional: template global manutencao-iterativa-com-evidencia1.2.0; merge seletivo preserva linhagem e politica locais.
Owner: executor do proximo corte; reviewer confere contratos e receipts.
Entrada: ler workflow/RULES.md, RULES.md deste pacote e perfil/politica locais antes de medir.
Dependencias: Python compativel; dex-complexidade-ciclomatica0.4.3 ou compativel validado; dex-criar-workflow-contexto-atual contrato1.3.0; Node22+ contato; provider/CLI code-review-graph e exporter1.2.0 quando disponivel. Sem instalacao implicita.
Schema-perfil: dex.complexidade.profile.v1, owner dex-complexidade-ciclomatica/references/schema-v2.json, validador scripts/v2_report.py::load_profile. Politica nao e entrada do medidor.

## Preflight na raiz do clone

```powershell
$meterEntry = Join-Path $env:USERPROFILE '.agents/skills/dex-complexidade-ciclomatica/scripts/medir_cc.py'
$contactEntry = Join-Path $env:USERPROFILE '.agents/skills/dex-criar-workflow-contexto-atual/scripts/contact-resume.mjs'
foreach ($requiredPath in @($meterEntry, $contactEntry)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "DEPENDENCY_MISSING: $requiredPath" }
}
python -B $meterEntry --help
python -B $meterEntry --schema
python -B $meterEntry --usage
node $contactEntry --schema
```

- Medicao: preservar comando/escopo autoral existente; profiles resolvem pelo CWD, nao --raiz. Capabilities precisam coincidir exatamente com perfil. Nesting e chamada separada; nao inventar threshold no perfil.
- Contato corrente: consumir helper da skill owner. Adaptador legado local, quando existente, so preserva exports e traduz observation.request_id antigo para reply_to_request_id. Contrato novo usa reply_to explicitamente.
- Mensagens: schema_id=dex.contact-resume.v1, schema_version=1, project_id, executor_conversation_id, request_id, response_required; respostas apontam reply_to_request_id. Envelope completo segue owner.
- Espera: resposta necessaria inicia210s, leituras incrementais30/90/150/210 com cursor e todas paginas, sem reenvio; resposta suficiente encerra; distinguir ausencia/insuficiencia/transporte. Informativa nao inicia polling; silencio nao aprova.
- Reuso: buscar codigo/grafo antes de criar; registrar reutilizar/adaptar/criar, contrato e responsabilidade. Dois consumidores independentes sao reuso observado; helper com um pode ser justificado. Medir conjunto com helpers, modulos/dependencias, esforco/regressoes; sem retorno imediato obrigatorio.
- CRG: reutilizar registry/DB do clone, bootstrap/update canonico se ausente/vazio/stale; baseline e dois cortes uteis sem fabrica-los. Partial/null nao e zero; ciclos so com comparacao valida que os reporte.
- Limite: teste global relocou no mesmo host; nao prova instalacao na maquina irma. Skills externas precisam ser instaladas/verificadas no destino.

Perfil-preservado: [JSON](profile-cc-v1.json); politica-preservada: [regua local](PERFIL-EXPERIMENTAL.md). Nao substituir por exemplo global.
