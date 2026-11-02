---
schema: dex.workflow.v1
slug: manutencao-iterativa-com-evidencia
version: 1.0.2
status: ativo
owner: executor PPIRTV; owner do comportamento; reviewer
created: 2026-11-02
updated: 2026-11-02
origem: template global manutencao-iterativa-com-evidencia@1.1.0
---

# Manutenção iterativa com evidência — PPIRTV

Documentos irmãos: [RULES.md](RULES.md) · [SCHEMA/SCHEMA.md](SCHEMA/SCHEMA.md) · [USAGE.md](USAGE.md) · [CHANGELOG.md](CHANGELOG.md) · [CAPACITY.md](CAPACITY.md)

Configuracao: [config.json](config.json) · [perfil consumivel](profile-cc-v1.json) · [politica PPIRTV v1](PERFIL-EXPERIMENTAL.md) · [scripts](scripts/INDEX.md) · [testes](tests/INDEX.md) · [referencias](references/INDEX.md).

## Promessa

Entrada adicional obrigatoria: [PORTABILITY.md](PORTABILITY.md), dependencias e contato owner; retrofit seletivo global1.2.0, regua local preservada.

Evolui um bloco coeso por vez, preservando comportamento e registrando por que uma abstração será reutilizada, adaptada ou criada. Usa testes, medições selecionáveis e grafo existente como evidências complementares, sem trocar manutenção futura por uma nota isolada.

## Quando usar

- Use quando: uma mudança funcional também precisa melhorar organização, separação de responsabilidades, interfaces, acoplamento ou reuso ao longo do tempo.
- Use quando: uma extração/refatoração possa mudar consumidores ou dependências e seja possível observar o comportamento antes e depois.
- NÂO use quando: a tarefa é só um hotfix de incidente sem escopo para refatoração; conclua a contenção e registre a dívida para um bloco posterior.
- NÂO use quando: a tarefa é Trilho/SPT, política de CI, admissão de skill, migração ampla ou desenho de um sistema distribuído; siga o owner específico.

## Pré-requisitos

- Entrada obrigatoria: na raiz do repo, ler `AGENTS.md`, `workflow/RULES.md`, [RULES.md](RULES.md), [SCHEMA/SCHEMA.md](SCHEMA/SCHEMA.md) e [perfil PPIRTV v1](PERFIL-EXPERIMENTAL.md). Registrar hashes e versoes; leitura declarada sem receipt nao e prova.
- Contato externo: ler [CONTACT-RESUME.md](references/CONTACT-RESUME.md); destino e executor sao configuracao local. Consumir checker compartilhado da skill owner, sem copiar codigo.
- Perfil: separar configuracao consumivel pelo medidor de politica interpretativa local. Perfil nao cria gate automatico; thresholds nao suportados ficam fora do JSON.

- Alvo: repo, bloco, comportamento esperado e owner de domínio identificados.
- Testes: rota existente para testar comportamento; se ela não existir, definir cobertura mínima do comportamento antes de aceitar a refatoração.
- Busca: acesso read-only ao repo e a catálogo/grafos pertinentes; uma busca sem resultados prova somente o escopo pesquisado.
- Medidor: usar `dex-complexidade-ciclomatica` se instalado; conferir `--help`, `--schema` e `--usage` antes de escolher opções.
- Grafo: usar somente provider CRG/uses-graph já existente e disponível. O medidor aceita snapshots JSON, mas não exporta nem atualiza CRG.
- Provider/grafo: use somente fontes, snapshots ou exports autorizados do repo-alvo. Um caso histórico local não faz parte do template nem é baseline reutilizável.
- Git: identificar `HEAD`, tree, índice, staged e working tree. Sem Git, registrar revisão e fingerprint como indisponíveis.
- Permissão: mudanças globais, hooks, gates ou serviços exigem owner e rota próprios; este workflow não os instala.
- Runtime: Python >=3.10, Node >=22, Git, CRG instalado no PATH e skills owners em `$env:USERPROFILE/.agents/skills`. Confirmar versoes e triades; nao instalar dependencia automaticamente.
- Fronteira fiscal: teto terminal por decisao do owner 2026-11-02; esta implantacao nao executa verdict, archive, novo Goal, reset, restart ou alteracao de consumidor.

Comandos da raiz, apos ler as regras:

```powershell
$env:PYTHONUTF8 = '1'
python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --help
python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --schema
python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --usage
python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --cut corte-local-01
python -B -m unittest discover -s workflow/manutencao-iterativa-com-evidencia/tests -p 'test_*.py'
```

- Destino: config.receipt_root/corte-local-01; create-only. Identificador novo para corte real, sem sobrescrever baseline. Script consome ferramentas owners; nao reproduz motores.

## Passos

1. Delimite um bloco coeso e o comportamento observável que deve permanecer. Registre repo, arquivos, consumidores conhecidos, dependências, owner, escopo e exceções.
   Verificação: objetivo pode ser expresso como comportamento testável; mudança não foi ampliada para sistema inteiro.

2. Antes de abstrair, pesquise no repo e nos mapas/ferramentas existentes por responsabilidade, interface e consumidores. Registre escopo, termos, comandos, candidatos e limites da busca. Compare semântica e contrato, não apenas semelhança sintática; escolha reutilizar, adaptar ou criar com justificativa. Reuso potencial pode ser intenção válida sem múltiplos consumidores atuais; reuso efetivo é outra afirmação e pede evidência.
   Verificação: a decisão tem evidência localizável e reconhece candidatos não inspecionados ou resultados vazios sem declarar inexistência universal.

3. Congele a linha de base antes da mudança. Registre `HEAD` e tree quando disponíveis, hash do arquivo de índice Git, `git status --porcelain=v2`, staged/unstaged e fingerprints dos arquivos lidos. Se o alvo tiver provider de grafo, consulte antes e registre repositório, revisão/estado, escopo, schema, versão do extrator, normalização, cobertura e unresolved. Não fabrique snapshot passado. Inspecione `core.hooksPath` e hooks já existentes apenas para entender a rota; não instale nem altere hooks. Se receipts, SQLite, MCP e CLI mostrarem valores diferentes, preserve cada leitura com sua proveniência e registre a divergência sem escolher uma silenciosamente.
   Verificação: baseline diferencia commit, índice e working tree; limitações, discrepâncias e campos ausentes estão explícitos. `HEAD` em metadata não prova estado da working tree; pre-commit não conhece o hash do commit futuro.

4. Implemente a menor mudança que faz o comportamento pedido funcionar em um bloco coerente. Escreva ou ajuste testes de comportamento antes ou durante a implementação quando isso ajudar; não espere a primeira versão para começar teste, segurança ou qualidade.
   Verificação: o diff está restrito ao bloco e os casos de comportamento/contrato estão nomeados.

5. Execute os testes de comportamento após fazer funcionar e salve comando, escopo e resultado. Falha de regressão -> corrija a mudança ou reverta a parte que a causa antes de prosseguir.
   Verificação: comportamento requerido passa, e falhas/limites não foram omitidos.

6. Refatore o bloco para responsabilidades coesas, interfaces claras, baixo acoplamento e reuso adequado, preservando o comportamento aprovado. Reaplique a decisão reutilizar/adaptar/criar se a implementação revelou contrato incompatível. Repita por blocos; não encerre somente porque a primeira versão funciona.
   Verificação: testes de comportamento continuam cobrindo o contrato; a abstração tem nome, fronteira e dependências justificadas.

7. Rode novamente os mesmos testes e as verificações de segurança/qualidade aplicáveis. Registre comparação antes/depois, revisão do diff e comportamento preservado. Não interprete mera queda de CC como benefício e não deixe aumento da soma vetar a abstração.
   Verificação: reteste passa sob o mesmo conjunto de casos; diferenças têm explicação ou ficam como pendência explícita.

8. Se útil e suportado, meça código bruto com capacidades selecionadas e mesma versão/configuração/escopo. Preserve raw values; avalie perfis em etapa separada como report-only. Nunca converta perfil, exemplo de threshold ou disponibilidade de capacidade em gate automático sem decisão explícita do owner.
   Verificação: motor/política, revisão, entradas e capacidades são rastreáveis; ausente/não aplicável/parcial não vira zero nem aprovação.

9. Executar capture-cut.py com identificador do corte real. Config.json declara graph.database (.agents/CODE-REVIEW-GRAPH/graph.db neste repo) e o script le esse valor do config (nao hardcode). O script atualiza esse banco e consome exporter 1.2.0 da skill code-review-graph e medidor 0.4.3 (minimo: 0.4.3 com range de corpo TS corrigido — raws de 0.4.2 sao fotografia historica nao comparavel, R13), preservando raw/log/receipt. Comparar somente schema, extrator, escopo, linguagens e normalizacao compativeis. Completeness partial e ciclos not_reported permanecem explicitos. Conferir MCP get_minimal_context no mesmo repo e head_matches_build=true; esse campo nao prova bytes dirty indexados.
   Verificação: diff identifica added/removed/changed nodes/edges e ciclos somente quando ambos lados os reportam; movimento sem identidade estável fica ambíguo; arestas e destinos unresolved são preservados. Sucesso do indexador não afirma completude.

10. Feche o bloco com diff, testes, decisão de reuso, valores brutos selecionados, avaliações de perfil separadas, proveniência dos snapshots e limitações/pendências com owner e quando. Registre mudança do hook/config somente se já existia e foi autorizada; não instale hook global por este procedimento.
    Verificação: revisor consegue separar mudança de código de mudança de medição e distinguir reuso potencial de uso efetivo.

11. Se o trabalho nasceu de instância local de workflow, registre linhagem do template e versão, adaptações locais e evidência do que funcionou. A instância é editável: ajuste local não é drift inválido por si só. Proponha melhoria local ao template somente quando houver ganho real evidenciado, generalização cross-repo, remoção de dados específicos, compatibilidade com schema, revisão e validação. Atualização do template pede merge/migração consciente na instância, mantendo histórico e rollback; nunca sobrescreva customizações automaticamente.
    Verificação: cada mudança está classificada como particularidade local ou melhoria promovível; qualquer promoção tem diff, justificativa, validação e versão/changelog global; o template atualizado não apagou alterações locais.

## Gotchas

- Achado por similaridade sintática → compare comportamento e contrato antes de reutilizar; texto parecido não prova equivalência.
- Busca vazia → declare somente “nenhum candidato no escopo/termos consultados”; não declare inexistência universal.
- Nenhum consumidor atual → reuso potencial ainda pode ser intenção arquitetural legítima; não alegue reuso efetivo sem evidência.
- Medidor não tem capability → marque indisponível/não aplicável; não impute zero nem instale parser duplicado.
- Threshold mudou → reavalie valores brutos guardados. Motor/política mudou → remedir. Código mudou → comparar revisões sob a mesma configuração quando possível.
- Não há snapshot anterior → não fabrique baseline; a partir deste bloco capture antes/depois.
- Snapshot tem mesmo contrato mas revisão diferente → diferença esperada; comparabilidade depende de extractor, schema, escopo, linguagens e normalização compatíveis.
- DB/MCP e CLI divergem → mantenha contagens e proveniência por fonte; concordância entre duas visões não explica a terceira.
- `immutable=1`, WAL zerado e `quick_check` válido → evidência de leitura e integridade reportada, não prova atomicidade frente a escritores concorrentes.
- Grafo ausente/vazio/stale → seguir bootstrap local da skill owner no data dir governado, sem duplicar bancos ou habilitar embeddings externos. Hook ausente nao autoriza instalacao.
- CC máxima diminuiu e soma aumentou → registre o trade-off observado; não use isso como veto ou prova de payback/dano sem evidência longitudinal.
- Testes foram executados somente no final → isso não proíbe testes anteriores; o próximo bloco pode caracterizar comportamento antes da implementação.
- Instância difere do template → confirme linhagem e motivo; não chame toda personalização de drift. Promoção exige evidência e generalização, e a adoção de atualização exige merge explícito com rollback.


## Regras comuns e comparacao de metodos

Antes da execucao, leia o `RULES.md` da raiz do ecossistema e depois o `RULES.md` deste pacote. Declare metodo/familia da acao e mantenha alternativas concorrentes quando houver mesmo resultado com escopo/responsabilidades/hipotese diferentes. Eleicao de padrao exige evidencia longitudinal comparavel, criterio, owner, localizadores e reversao. Registre desconhecidos como desconhecidos; fixture sintetica valida contrato, nao ganho real.

## Responsabilidades e evidencias

| Etapa | Responsavel | Entrada | Saida | Conclusao/evidencia |
|---|---|---|---|---|
| 1 escopo | owner do comportamento | pedido e autorizacao | corte e limites | comportamento verificavel |
| 2 reuso | executor + reviewer | fontes e CRG | reutilizar/adaptar/criar | candidatos e consumidores independentes |
| 3 baseline | executor | bytes e config atuais | snapshot + valores brutos | versoes, hashes e lacunas |
| 4 funcionar | executor | contrato do corte | menor mudanca completa | diff e casos de comportamento |
| 5 comprovar | tester | implementacao | resultados | comando/exit/falhas/skips |
| 6 refatorar | executor + reviewer | comportamento aprovado | responsabilidades claras | interfaces e dependencias |
| 7 retestar | tester | diff refatorado | reteste | mesmos casos e regressao |
| 8 medir | medidor owner | codigo/config/capabilities | raw + perfil | quantidades measured/partial/missing |
| 9 grafo | CRG owner | banco do repo | snapshot/diff | identidade e escopo compativeis |
| 10 fechar | reviewer + owner | todas as provas | receipt e pendencias | owner/quando; sem ganho inventado |
| 11 reconciliar | workflow owner | melhorias locais | promocao ou personalizacao | origem, teste, versao e reversao |

- Conjunto afetado: medir funcao e helpers; registrar dependencias, modulos, esforco observado e regressoes. Soma/maximo sao trade-offs, nao veredito de arquitetura.
- Reuso observado: dois consumidores independentes; chamadas repetidas do mesmo consumidor contam uma vez. Um consumidor pode justificar helper por responsabilidade/contrato, sem inventar reuso.
- Longitudinal: comecar baseline e dois cortes uteis; nao fabricar mudancas ou passado. Sem cortes comparaveis, manter acompanhamento pendente com owner e quando.
