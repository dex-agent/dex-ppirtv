# Contrato de efeitos das tools MCP

`LOCALIZER: PPIRTV-MCP-TOOL-EFFECTS-CONTRACT`

Versão do contrato: `1.0.0`  
Status de produto: `Unreleased`  
Owner: adaptador MCP do `dex-PPIRTV`

## Objetivo

Publicar em `tools/list` metadados verdadeiros e completos sobre os efeitos das
32 tools do `dex-PPIRTV`. Esses metadados ajudam hosts e modelos a distinguir
leitura, criação aditiva e mutação de estado sem depender de arqueologia do
código.

O schema vivo retornado por `tools/list` é a autoridade de execução. Este
documento explica as invariantes e a recuperação de falhas; não substitui o
schema dinâmico.

## Fonte viva

- catálogo tipado e fail-closed: `src/mcp/tool-effects.ts`;
- registro das tools: `src/server.ts`;
- prova de transporte: `tools/list` real pelo servidor stdio;
- testes de contrato: `tests/tool-effects.test.ts` e `tests/mcp.test.ts`.

## Semântica MCP usada

As quatro annotations seguem a semântica do SDK MCP instalado:

- `readOnlyHint=true`: a tool não modifica o ambiente;
- `destructiveHint=false`: uma tool mutável faz somente atualizações aditivas;
- `destructiveHint=true`: a tool pode substituir ou alterar estado existente;
- `idempotentHint=true`: repetir os mesmos argumentos não acrescenta efeito;
- `openWorldHint=false`: a interação permanece no workspace, runtime e
  integrações locais configuradas pelo produto.

`destructiveHint=true` não significa, sozinho, que a operação seja maliciosa
ou insegura. Significa que ela não pode ser descrita honestamente como somente
aditiva. O campo só é material quando `readOnlyHint=false`.

Annotations são dicas declaradas pelo servidor. Elas não são autorização,
controle de acesso, sandbox, política de aprovação ou garantia de confiança.
O host continua responsável por decidir se executa a chamada.

## Catálogo canônico

Todas as tools declaram os quatro hints. O catálogo falha na carga se faltar um
nome canônico, se houver nome excedente ou se uma combinação contradizer sua
classe de efeito. Todo registro de produto passa pela façade tipada
`registerPpirtvTool`; um teste estrutural proíbe chamadas diretas a
`server.registerTool` fora dela por inspeção AST, inclusive acesso com
whitespace, optional chaining, chave literal ou destructuring. O teste stdio
compara o catálogo com o `tools/list` real. Essa combinação impede bypass no
build/test; não é descrita
como uma introspecção mágica de registros privados do SDK em runtime.

### Leitura — 3 tools

Annotations: `readOnlyHint=true`, `destructiveHint=false`,
`idempotentHint=true`, `openWorldHint=false`.

```text
runtime_probe
ppirtv_trace
spt_validate
```

### Atualização aditiva — 11 tools

Annotations: `readOnlyHint=false`, `destructiveHint=false`,
`openWorldHint=false`.

```text
flow_create
flow_status
meeting_open
checklist_render
hygiene_scan
goal_status
ppirtv_checkout
goal_gate_preflight
goal_progress_record
goal_meeting_open
goal_meeting_add_turn
```

`flow_status`, `checklist_render` e `goal_gate_preflight` apenas consultam o
domínio, mas o contrato atual de leitura do store inicializa diretórios ausentes
e um ledger vazio. Esse efeito acontece inclusive antes de uma resposta de flow
inexistente. Por isso são aditivas e idempotentes, não read-only. Remover essa
inicialização implícita pertence a um Trilho de store separado.

`goal_status` e `ppirtv_checkout` são contextuais: `detail=lean` apenas lê,
enquanto `compact`/`full` pode anexar um receipt de recall do hook pré-fase. O
guard persiste um estado reconhecível e a repetição idêntica o reutiliza; por
isso ambas são aditivas e idempotentes. `goal_progress_record` também é
idempotente por `event_key`. As outras cinco tools deste grupo não prometem
idempotência.

### Mutação de estado — 18 tools

Annotations: `readOnlyHint=false`, `destructiveHint=true`,
`openWorldHint=false`.

```text
flow_advance
flow_return
gate_check
meeting_record
evidence_attach
verdict_record
flow_archive
goal_start
goal_resume
goal_gate_check
goal_advance
goal_meeting_close
mm_memory_mining
mm_memory_candidate_resolve
mm_pipeline_run
evidence_add
goal_verdict
goal_regress
```

`flow_archive` e `goal_meeting_close` possuem `idempotentHint=true`: a mesma
operação terminal reutiliza o estado congelado e não acrescenta outro save ou
evento. As outras 16 tools desta classe não prometem idempotência.

`evidence_attach` e `evidence_add` criam evidência, mas também podem substituir
o `implementation_fingerprint` que participa dos gates de coerência da revisão.
Portanto seu efeito máximo é mutação de estado, não apenas append.

Quando uma tool possui um modo opcional somente leitura, mas sua chamada
normal também pode persistir, a annotation descreve o efeito máximo da tool.
Por exemplo, `gate_check` não vira read-only apenas porque aceita
`persist=false`.

## Exemplo mínimo para agentes pequenos

Primeiro consulte `tools/list`. A declaração esperada para `runtime_probe` é:

```json
{
  "name": "runtime_probe",
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

Depois chame `runtime_probe` diretamente. Não faça arqueologia do repositório
para descobrir a identidade do runtime antes dessa tentativa.

O receipt declara o comportamento de forma explícita:

```json
{
  "mutated": false,
  "project_root": "C:\\caminho\\do\\workspace",
  "ppirtv_home": "C:\\caminho\\do\\workspace\\.ppirtv"
}
```

Quando o host adia tools por orçamento de contexto, use a descoberta nativa de
tools/MCP para localizar `dex_ppirtv.runtime_probe` e então chame somente essa
tool. Descoberta nativa não é filtro de catálogo; criar `enabled_tools`, proxy,
wrapper ou alias exclusivo continua proibido como prova de produção.

## Aprovação headless e responsabilidade

O `dex-PPIRTV` é owner da veracidade das annotations e do transporte delas em
`tools/list`. O host MCP é owner da política de aprovação e da decisão de
executar ou cancelar uma chamada.

No Codex, são duas camadas diferentes:

1. `--ask-for-approval` / `-a` controla quando o Codex pausa antes de executar
   comandos;
2. `mcp_servers.<id>.default_tools_approval_mode` controla a política das
   tools daquele servidor MCP.

Para usar as annotations como fronteira proporcional, configure a tabela já
existente do servidor (não crie uma segunda tabela com o mesmo nome):

```toml
[mcp_servers.dex_ppirtv]
default_tools_approval_mode = "writes"
```

O modo oficial `writes` pede aprovação para tools que não estão marcadas como
read-only. Assim, `runtime_probe` pode entrar sem prompt, enquanto tools
aditivas ou mutantes continuam na fronteira de aprovação do host. `-a never`
sozinho não demonstra essa relação causal.

Para um forward-test não interativo sem persistir configuração, use o override
oficial da CLI junto da configuração normal:

```powershell
codex -a never -c 'mcp_servers.dex_ppirtv.default_tools_approval_mode="writes"' exec --ephemeral --strict-config -m gpt-5.4-mini -s read-only -C C:\CodexProjetos\dex-PPIRTV --json '<prompt que permite descoberta nativa e chama somente runtime_probe>'
```

Esse override efêmero não filtra tools e não substitui a configuração de
produção: ele prova a mesma chave que pode viver na tabela normal do servidor.
Fonte do contrato do host: Codex Manual, `Model Context Protocol` e
`Configuration Reference`.

Uma execução headless não pode depender de confirmação humana interativa. Ela
também não pode resolver o problema escondendo tools, criando proxy, wrapper,
alias exclusivo, renomeação para um modelo ou configuração que não existirá em
produção.

Se `runtime_probe` for cancelada depois de o host receber as annotations
corretas, o diagnóstico mínimo é:

```json
{
  "code": "MCP_HOST_TOOL_CALL_CANCELLED",
  "owner": "host_integration",
  "field": "approval_policy",
  "reason": "O host cancelou uma tool declarada read-only antes de o dex-PPIRTV receber a chamada.",
  "next_required_action": "Corrigir ou documentar a política headless do host e repetir a mesma chamada de produção sem filtro, proxy ou wrapper.",
  "recoverable": true
}
```

Esse objeto é o contrato de relato para uma falha anterior à entrada no
`dex-PPIRTV`; ele não afirma que o servidor conseguiu devolver um receipt de
uma chamada que nunca recebeu.

## Fail-closed do catálogo e do build

A carga do catálogo/façade deve falhar quando encontrar:

- tool pública sem declaração;
- declaração para tool inexistente;
- rationale vazio;
- qualquer hint ausente ou não booleano;
- tool mutável marcada como read-only;
- tool aditiva marcada como destrutiva;
- mutação de estado marcada como apenas aditiva;
- interação aberta declarada sem contrato correspondente.

Além disso, o build/test falha se fonte de produto chamar `server.registerTool`
fora da façade tipada ou se o `tools/list` real divergir das 32 declarações. O
SDK não oferece aqui introspecção privada usada para prometer um bloqueio
mágico de qualquer bypass futuro em runtime; a garantia verificável é
façade + teste estrutural + stdio real antes de publicação.

Uma tool declarada read-only não pode inicializar `.ppirtv`, criar diretórios ou
criar o ledger. O RED canônico executa `runtime_probe` em workspace vazio e
compara a árvore antes/depois. `runtime_probe` usa uma inspeção própria do
adapter que não chama `store.init()`. O efeito inicializador das três consultas
citadas na classe aditiva permanece explícito e não é mascarado neste corte.

Adicionar uma 33ª tool exige adicionar sua declaração e seus testes no mesmo
change set. Um teste unitário isolado não substitui `tools/list` real.

## Compatibilidade e versão

Adicionar annotations verdadeiras sem renomear tools nem alterar seus schemas é
uma capacidade pública aditiva e candidata a `MINOR`. Isso não decide o bump da
próxima release: a classificação deve considerar todo o conteúdo acumulado em
`Unreleased` e as diferenças em relação à última release comprovada.

Não há autorização implícita para bump, tag ou release.

## Validação

```powershell
npm run build
npx vitest run tests/tool-effects.test.ts tests/mcp.test.ts
npm run smoke:mcp-tools -- --workspace C:\CodexProjetos\dex-PPIRTV
npm run check
```

Além dos comandos, exija um `tools/list` stdio real com 32/32 annotations e um
forward-test pela rota de produção configurada para o host alvo.
