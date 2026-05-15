# 02 - MCP Harness Architecture

## 1. Arquitetura logica

```text
Client / Host
  |
  | MCP stdio
  v
PPIRTV MCP Server
  |
  +-- Tool Registry
  +-- Resource Registry
  +-- Prompt Registry
  +-- Flow Engine
  +-- Gate Engine
  +-- Meeting Engine
  +-- Ledger Store
```

## 2. Componentes

| Componente | Responsabilidade |
| --- | --- |
| `McpServer` | Inicializacao, capabilities e roteamento MCP |
| `FlowEngine` | Criar, avancar, retornar e arquivar flows |
| `GateEngine` | Avaliar criterios por fase |
| `MeetingEngine` | Estruturar reunioes e registrar saidas |
| `EvidenceStore` | Guardar links e artefatos de evidencia |
| `LedgerStore` | Registrar eventos append-only |
| `PromptCatalog` | Expor prompts PPIRTV |
| `ResourceCatalog` | Expor estado e templates por URI |
| `PpirtvStore` | Persistir JSON/NDJSON em `.ppirtv/` |

## 2.1 Stack do MVP

- TypeScript em Node.js 22.
- `@modelcontextprotocol/sdk` para `McpServer` e `StdioServerTransport`.
- Vitest para testes unitarios e integracao MCP.

## 3. Capabilities do MVP

```json
{
  "tools": {
    "listChanged": false
  },
  "resources": {
    "listChanged": true
  },
  "prompts": {
    "listChanged": false
  }
}
```

## 4. Transporte

MVP: `stdio`.

Motivo:

- simples para cliente local;
- menor superficie de seguranca;
- nao exige auth HTTP no primeiro corte;
- combina com processo local de harness.

HTTP Streamable pode entrar depois para dashboards, multiplos clientes ou uso
remoto, com controles de `Origin`, auth e `MCP-Protocol-Version`.

## 5. Estado

O servidor deve retornar `flow_id` em `flow_create`. Todas as tools seguintes
devem receber `flow_id`.

Nao depender de:

- variavel global invisivel;
- conexao MCP atual;
- ordem informal da conversa;
- memoria do modelo.

## 6. Contrato de erro

| Caso | Resultado |
| --- | --- |
| `flow_id` ausente | erro de parametros invalidos |
| fase invalida | erro de parametros invalidos |
| gate incompleto | resposta estruturada `blocked` |
| evidencia inexistente | erro acionavel com path/URI |
| ledger indisponivel | erro interno com diagnostico seguro |
