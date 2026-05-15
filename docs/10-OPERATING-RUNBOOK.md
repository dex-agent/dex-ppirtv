# 10 - Operating Runbook

## 1. Iniciar um flow

1. Chamar `flow_create`.
2. Registrar objetivo.
3. Confirmar fase `pensamentos`.
4. Renderizar checklist.

## 0. Rodar servidor local

```bash
npm install
npm run build
npm start
```

O servidor usa MCP por `stdio`. Configure o cliente MCP para executar
`node dist/index.js` a partir da raiz do projeto.

## 0.1 Governanca de especialistas

No processo PPIRTV da Fernanda, os especialistas sao resolvidos sempre a partir
do registry compartilhado:

```powershell
$env:USERPROFILE\.agents\skills\
```

Fontes canonicas:

- Governanca da mesa: `$env:USERPROFILE\.agents\skills\00-governanca-mesa-de-skills.md`
- Indexacao rapida: `$env:USERPROFILE\.agents\skills\INDEX.md`

O harness MCP registra fases, gates, reunioes, evidencias e vereditos. Ele nao
deve copiar skills para dentro do projeto nem depender de caminhos fixos de
usuario alem dessas variaveis de ambiente documentadas.

## 2. Avancar fase

1. Consultar `flow_status`.
2. Chamar `gate_check`.
3. Se aprovado, chamar `flow_advance`.
4. Se bloqueado, registrar retorno ou proxima acao.

## 3. Abrir reuniao divergente

Use quando:

- ha loop;
- ha bug recorrente;
- ha incerteza real;
- alternativas nao foram exploradas.

Saida:

- lista de perguntas;
- hipoteses;
- riscos;
- criterios de convergencia.

## 4. Abrir reuniao convergente

Use quando:

- alternativas existem;
- e preciso escolher uma;
- escopo esta crescendo.

Saida:

- decisao;
- trade-off;
- criterio de pronto.

## 5. Abrir reuniao transversal

Use quando:

- a mudanca cruza areas;
- existe risco de regressao escondida.

Saida:

- areas impactadas;
- gates extras;
- donos;
- rollback.

## 6. Encerrar flow

1. Anexar evidencia.
2. Rodar checklist de higiene.
3. Registrar veredito.
4. Arquivar.
