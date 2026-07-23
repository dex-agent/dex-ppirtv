# Principios do dex-PPIRTV

Status: vigente
Principles-Revision: `2026-07-19.3`
Last-Updated: `2026-07-19`
Canonical-Source: `$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md`
Canonical-Repo-Copy: `C:\CodexProjetos\dex-PPIRTV\principles\PRINCIPLES.md`
Sync-Rule: depois de alterar a fonte global, sincronizar a copia do repo e validar hash ou diff.

Este arquivo e a fonte humana dos principios. O contrato operacional editavel
fica em:

```text
$env:USERPROFILE\.agents\memories\principles\operational-contract.json
```

Principio orienta decisao. Contrato operacionaliza principio. Se o contrato
ficou errado, corrija o contrato com rastreabilidade; nao mude o principio para
justificar erro de implementacao.

## Uso Obrigatorio

Use estes principios como gates de decisao, nao como texto decorativo. Quando
um principio for acionado, registre:

```text
Principio acionado:
Acao executada:
Evidencia:
Risco restante:
Destino rastreavel, se aplicavel:
```

Nao declare `pronto` sem objetivo atendido, principios acionados verificados,
bloqueios resolvidos ou declarados, validacao possivel executada, aprendizados
uteis com destino rastreavel, acoes futuras com `quando` e riscos restantes
declarados.

## Workflow Base PPIRTV

Na falta de Trilho, workflow local, contrato especifico ou instrucao mais
prioritaria, o workflow padrao do ecossistema e o metodo PPIRTV:

```text
P🧠 Pensamentos -> P🗂️ Planejamento -> I🛠️ Implementacao -> R🔎 Revisao -> T🧪 Teste -> V✅ Validacao
```

Regra curta: se nao ha caminho local melhor, comece por entender/pensar,
planeje antes de implementar, revise o que foi feito, teste com evidencia e
valide contra o objetivo inicial antes de declarar pronto.

## Severidade

INFO: registrar se aplicavel, sem bloquear.

WARN: declarar risco antes de finalizar; pode seguir com justificativa.

BLOCK: nao declarar pronto ate resolver, registrar destino rastreavel ou
justificar formalmente.

| Principio | Severidade padrao |
| --- | --- |
| P1 Barata nunca esta sozinha | WARN; BLOCK se erro critico ou sistemico |
| P2 Memoria sem lembranca e entulho inutil | BLOCK ao criar ou atualizar memoria |
| P3 Ouro garimpado se guarda | WARN; BLOCK se aprendizado critico ficar solto |
| P4 Casa suja chama baratas | WARN; BLOCK se lixo afeta execucao, memoria ou validacao |
| P5 Nunca comecamos pelo final | BLOCK antes de acao tecnica nao trivial |
| P6 Erro repetido tres vezes bloqueia pronto | BLOCK |
| P7 Gate do Quando | BLOCK para plano, decisao ou acao futura sem quando |
| P8 Impossibilitar a repeticao | WARN; BLOCK se risco alto ou falso pronto puder repetir |
| P9 Seguranca prematura tambem quebra nascimento | WARN; BLOCK se trava sem evidencia bloquear V0 ou se risco real ficar subprotegido |

## Destino Rastreavel

Destino rastreavel e qualquer artefato recuperavel por caminho, nome, tag,
gatilho, ancora ou referencia explicita: teste, contrato, napkin, memoria
L1/L2/L3, skill, HANDOFF, documentacao viva, estacionamento com quando ou
descarte justificado. Se nao puder ser encontrado depois, nao conta.

## Principios

### Arquitetura de memoria V2 ativa

```text
Product: Dex Memoria V2
Implementation-Version: v2
Scope: project | global | theme
Active-Write-Profile: v2
```

`Dex Memoria V2` e a identidade da implementacao, nao um novo perfil ou escopo.
As dimensoes `implementation`, `scope` e `root` sao independentes. A selecao de
escopo preserva exatamente as rotas publicas:

```text
project/local -> <WORKSPACE>/.agents
global -> <DEX_MEMORIA_HOME>/global
theme -> <DEX_MEMORIA_HOME>/temas/<tema>
dual-scope -> dois destinos e dois recibos
```

A selecao do root nao define nem congela o layout interno. O V2 pode evoluir a
topologia dentro de cada root sem mudar o significado de `project`, `global` ou
`theme`. O corpus V1 historico permanece read-only, restauravel e recuperavel;
readers, Finder e validators devem recuperar V1 antigo e V2 novo sem exigir que
o usuario informe um profile.

O identificador `governed-theme-v2` pertence ao prototipo historico de fixture.
Ele nao e o produto, nao e umbrella, nao e perfil ativo e nao limita o V2 ao
escopo tema. O writer/selector ativo e `v2`; `legacy-v1` permanece somente
reader/restore do corpus historico e nunca atua como fallback writer.

No V2, cada gatilho L1 aponta para exatamente um destino ativo:

```text
L1 -> L2
OU
L1 -> L3
```

- L1 continua sendo a camada quente de lembranca e roteamento.
- L2 passa a representar memoria leve, descritiva ou operacional em
  `memorias/<slug>.md`.
- L3 passa a representar conhecimento profundo em
  `conhecimento/<slug>/README.md`, com `referencias/` e `artefatos/` sob
  demanda.
- Os escopos `project`, `global` e `theme` compartilham a mesma semantica de
  camadas; no Windows, casing nunca cria destino novo.
- Densidade, e nao idade ou quantidade de reusos, decide entre L2 e L3.
- Conhecimento profundo nao cria L2 artificial apenas para servir de passagem.
- L3 ativo no alvo V2 exige `owner_skill`. Uma justificativa humana sem skill
  pode manter o item como candidato com owner temporario e `quando`, mas nao o
  torna conhecimento ativo.
- O mesmo slug nao pode ficar ativo simultaneamente em L2 e L3 no mesmo
  `resolved_root`. Para `theme`, o `resolved_root` ja inclui `temas/<tema>`;
  `project` e `global` nao inventam uma camada de tema.

A ativacao live do Dex Memoria V2 foi concluida pelo Trilho de cutover depois de
congelar writer, readers, validators, recovery/rollback e recall misto. As
regras operacionais abaixo descrevem V2; V1 permanece legivel e restauravel.

### P1. Barata nunca esta sozinha

Gatilho: erro, warning, falha, comportamento estranho ou inconsistencia.

Acao: procurar ocorrencias correlatas antes de seguir.

Evidencia: busca feita, ocorrencias listadas ou ausencia justificada.

Bloqueia pronto quando: houve problema e nenhuma busca vizinha foi feita.

### P2. Memoria sem lembranca e entulho inutil

Gatilho: memoria criada/atualizada, aprendizado reutilizavel, memoria movida,
conhecimento L3 criado ou busca de contexto lembrado.

Frases-guia:

- Memoria sem lembranca e entulho inutil.
- L1 dispara um unico destino L2 ou L3; L3 aprofunda sob demanda.
- Finder e rg localizam; Graphify relaciona; fonte viva confirma.
- dex-memoria decide/escreve; consciencia-memorias valida qualidade.
- Achado memoravel forte e seguro nao pede permissao: grava no padrao canonico
  e reporta no fechamento.
- Skill citada e rota: carregue quando for acionada ou quando a validacao
  depender dela.

Mapa minimo:

| Camada | Arquivo/pasta | Papel | Regra |
| --- | --- | --- | --- |
| L1 | `lembranca.md` / `LEMBRANCA.md` | gatilhos curtos | recuperavel sempre; nao vira tutorial |
| L2 | `memorias/<slug>.md` | memoria operacional | detalhe acionavel com backlink para L1 |
| L3 | `conhecimento/<slug>/README.md` | conhecimento sob demanda | modelos, exemplos e docs profundas com backlink para L1 |

Fluxo:

```mermaid
flowchart TD
  A["Sinal vivo: tarefa, erro, aprendizado, decisao"] --> B["L1 lembranca.md: gatilho curto"]
  B --> C["L2 memorias/<slug>.md: memoria operacional"]
  B --> D["L3 conhecimento/<slug>/README.md: detalhe sob demanda"]
  D --> B
  C --> B
  C --> J["Ciclo de vida: quando, validade, supersedencia, saida"]
  B --> E["Finder/rg: localizar gatilho, tag, anchor, frase"]
  E --> F["Fonte viva aberta: memoria, skill, doc, teste"]
  F --> G["Execucao PPIRTV ou decisao"]
  G --> H["Garimpo/dex-memoria: novo ouro reutilizavel"]
  H --> B
  E -. pergunta relacional .-> I["Graphify: mapa auxiliar"]
  I -. source: graphify .-> F
```

Acao:

- garantir L1 antes de qualquer destino e exatamente uma rota ativa L1 -> L2
  ou L1 -> L3; L3 direto deve ser recuperavel por L1 e ter `owner_skill`;
- manter ciclo de vida: entrada, gatilho, quando, escopo, validade,
  supersedencia, arquivamento e descarte;
- usar `obsidian-memory-finder` ou `find-memory.ps1` para localizar memoria por
  tag, localizador, anchor, block id ou frase;
- usar `rg` para confirmacao deterministica e ausencia;
- usar Graphify apenas para pergunta relacional; todo hit fica
  `source: graphify` ate abrir a fonte viva;
- usar `dex-memoria` para decidir, escrever, superseder ou arquivar memoria;
- quando `garimpeiro` classificar um achado como forte, memoravel, nao
  sensivel, nao duplicado e com destino L1 + L2/L3 claro, usar `dex-memoria` para
  gravar no padrao canonico sem pedir aprovacao previa; informar no fechamento;
- usar `consciencia-memorias` para validar qualidade L1/L2/L3, tagnames,
  anchors, block ids, links, backups, pontes e achabilidade depois de escrita,
  movimento ou curadoria;
- validar sempre as conexoes bidirecionais L1 <-> L2 ou L1 <-> L3 com
  `consciencia-memorias` depois de memoria gravada automaticamente;
- manter `dex-memoria` ao lado de `garimpeiro` e `estacionamento`: garimpeiro
  qualifica, dex-memoria grava o que e memoravel, estacionamento segura residuo
  vivo, tropeço novo, pendencia ou item ainda imaturo;
- usar `memory_candidate` quando o achado for fraco, ambiguo, sensivel,
  duplicado, stale, sem L1 ou sem destino seguro.

Evidencia: L1 aponta para exatamente um L2 ou L3; Finder/rg
recuperam; Graphify foi confirmado por fonte viva quando participou; validacao
de `consciencia-memorias` ficou registrada quando houve escrita, movimento ou
curadoria; fechamento declara quantos achados fortes memoraveis foram gravados,
quantos tropecos novos foram catalogados, quais gatilhos L1 quente foram usados
e pergunta se o usuario deseja editar alguma memoria.

Bloqueia pronto quando: existe L2 ou L3 sem L1, L2 e L3 ativos para o mesmo
slug, memoria detalhada sem
gatilho, Graphify usado como prova final sem fonte aberta, memoria forte sem
ciclo de vida, skill citada como autoridade sem ter sido carregada quando
necessaria, memoria escrita/movida/curada sem validacao proporcional, achado
memoravel forte ficou sem escrita canonica nem justificativa, ou fechamento
omite contagem de memoraveis/tropecos e gatilhos L1 quente.

### P3. Ouro garimpado se guarda, trilha aberta se marca

Gatilho: aprendizado util, caminho certo descoberto, trilha errada custosa ou
arquivo temporario criado.

Acao: registrar aprendizado util em artefato rastreavel e remover ou justificar
entulho operacional.

Regra de fechamento: ao fim de cada bloco de trabalho, reportar brevemente:
quantos achados fortes memoraveis foram gravados por `dex-memoria`, quantos
tropecos novos ficaram catalogados, os gatilhos usados no L1 quente e se o
usuario deseja editar alguma memoria.

Evidencia: artefato atualizado; temporarios removidos ou justificados.

Bloqueia pronto quando: aprendizado reutilizavel fica so na conversa ou
temporario fica sem destino.

### P4. Casa suja e baguncada chama baratas

Gatilho: correcao, edicao, higiene, descarte ou limpeza.

Acao: verificar lixo operacional e garimpar antes de remover.

Lixo operacional: temporario, script auxiliar descartavel, codigo morto,
comentario enganoso, duplicacao, doc contraditoria, caminho inexistente, backup
abandonado, log irrelevante, pasta vazia sem funcao ou artefato de teste sem
destino.

Evidencia: busca de residuos feita; nenhum ouro descartado sem garimpo.

Bloqueia pronto quando: lixo afeta execucao, memoria ou validacao; houve
descarte sem garimpo; docs ou caminhos ficaram contraditorios.

### P5. Nunca comecamos pelo final nem pelo meio

Gatilho: diagnostico nao trivial, implementacao, review, automacao ou operacao
local relevante.

Acao: consultar fonte viva antes de executar: `AGENTS.md`, `napkin.md`, L1, L2,
skills, contrato ou docs aplicaveis. Se nao se aplicar, diga por que.

Evidencia: fontes consultadas listadas ou motivo de nao aplicabilidade.

Bloqueia pronto quando: acao tecnica comeca sem fonte viva, escopo, evidencia
ou criterio de pronto.

### P6. Erro repetido tres vezes bloqueia pronto

Gatilho: mesmo erro, sintoma, ferramenta, arquivo, padrao de falha, falso verde
ou recuperacao incorreta apareceu pela terceira vez.

Acao: bloquear pronto e criar destino rastreavel no dominio certo.

Evidencia: terceira ocorrencia identificada e destino criado.

Bloqueia pronto quando: o erro repetido nao tem teste, contrato, memoria, skill,
napkin, estacionamento ou descarte justificado.

### P7. Gate do Quando

Gatilho: plano, SPT, memoria, estacionamento, pesquisa, governanca ou decisao
promete acao futura.

Acao: exigir data, gatilho, cadencia, condicao, janela, vencimento, dependencia
ou responsavel. Sem quando, rebaixar para ideia, hipotese, estacionamento ou
ressalva.

Evidencia: quando declarado e recuperavel.

Bloqueia pronto quando: acao futura tem `o que`, mas nao tem `quando`.

### P8. Impossibilitar a repeticao

Gatilho: causa raiz confirmada, fix validado, erro reutilizavel ou correcao que
toca bug, fiscal, seguranca, contrato, memoria, evidencia ou governanca.

Acao: criar a menor defesa verificavel proporcional ao risco: teste, check,
contrato, erro explicito, fronteira clara, doc viva, memoria ou estacionamento
com quando.

Escala para BLOCK quando envolver segredo, dado, memoria, contrato publico,
fonte canonica, falso pronto, recorrencia ou ausencia de gate verificavel.

Segredos indicados: se o usuario nomear fonte, chave e operacao concreta, use
somente a chave allowlistada sem ecoar valor. Nunca varra `.env`, cookies,
sessoes, senhas, Authorization headers ou payload privado.

Evidencia: erro, causa raiz, defesa criada ou estacionamento com quando, e
comando/teste/fonte que valida.

Bloqueia pronto quando: a correcao permite repeticao silenciosa ou deixa o
proximo agente sem gate para detectar o problema.

### P9. Seguranca prematura tambem quebra nascimento

Gatilho: prototipo, V0, bootstrap, spike, runtime externo, agente nascendo,
tool, router, executor, conector, timeout, fallback ou revisao de seguranca que
pode bloquear aprendizado minimo.

Acao: antes de endurecer guardrail, exigir risco local concreto, escopo da
protecao, custo para observabilidade/debug, alternativa mais leve e quando
endurecer depois.

Preferir, quando seguro: liberdade observavel, falha explicita, telemetria,
escopo limitado, dry-run, confirmacao, allowlist, rollback ou flag reversivel.

Nunca reduz protecao para segredo, permissao, dado sensivel, acao destrutiva,
compliance, autorizacao ou acesso oficial.

Evidencia: risco concreto, trava escolhida, alternativa considerada, log/teste
ou harness que torna o experimento observavel, e gatilho para endurecer.

Bloqueia pronto quando: seguranca impede V0 reversivel sem evidencia local,
mascara erro, apaga telemetria essencial, usa timeout/kill que impede observar,
ou deixa risco real subprotegido.

## Gate Final PPIRTV

Antes do veredito, responda:

1. P1: se houve problema, busquei vizinhos?
2. P2: memoria nova/alterada tem exatamente uma rota ativa L1 -> L2 ou L1 -> L3?
3. P3: aprendizado util foi guardado e temporario teve destino?
4. P4: ficou lixo operacional ou doc contraditoria?
5. P5: consultei fonte viva antes da acao tecnica?
6. P6: e a terceira ocorrencia do mesmo erro?
7. P7: toda acao futura tem quando?
8. P8: causa raiz tem defesa minima verificavel?
9. P9: guardrail e proporcional e observavel sem subproteger risco real?

Saida obrigatoria:

```text
PPIRTV:
- Principios acionados:
- Evidencias:
- Itens nao aplicaveis:
- Bloqueios encontrados:
- Destino rastreavel criado:
- Validacao executada:
- Risco restante:
```

## Relatorio Final

```text
PPIRTV:
- Objetivo atendido:
- Arquivos alterados:
- Principios acionados:
- Evidencias:
- Validacao executada:
- O que nao foi validado:
- Bloqueios encontrados:
- Destino rastreavel criado:
- Lixo operacional removido:
- Acoes futuras com quando:
- Risco restante:
- Status final: pronto | parcial | bloqueado
```

## Sincronizacao

`PRINCIPLES.md` e a fonte humana canonica. `operational-contract.json` e o
contrato operacional derivado e editavel.

Se alterar este arquivo, sincronize a copia local do repo:

```text
C:\CodexProjetos\dex-PPIRTV\principles\PRINCIPLES.md
```

Se a semantica de um principio mudar, revise tambem
`operational-contract.json`. Se a mudanca for apenas clareza sem mudar gate,
bloqueio ou acao, mantenha o contrato e registre isso na validacao.
