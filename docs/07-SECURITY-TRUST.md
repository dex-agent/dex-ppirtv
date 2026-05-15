# 07 - Security and Trust

## 1. Superficie de risco

| Risco | Mitigacao |
| --- | --- |
| Tool destrutiva | Confirmacao explicita e fora do MVP |
| Injetar prompt via docs | Separar fonte, evidencia e instrucao |
| Vazamento de segredo | `.env` ignorado e nunca logar tokens |
| Estado implicito enganoso | Exigir `flow_id` em chamadas |
| Reuniao virar autoridade falsa | Exigir evidencia e veredito |
| HTTP local exposto | MVP usa `stdio`; HTTP futuro deve validar `Origin` e auth |

## 2. Regras

- Nao executar comandos destrutivos no MVP.
- Nao alterar repos de terceiros sem tool explicita.
- Nao aceitar veredito sem evidencia ou ressalva.
- Nao gravar segredo em ledger.
- Nao usar headers para parametros sensiveis.

## 3. Trust model

O harness ajuda o agente a trabalhar melhor, mas nao e fonte absoluta de verdade.
Fontes vencem nesta ordem:

1. Evidencia tecnica atual.
2. Codigo/configuracao real.
3. Documentacao viva.
4. Ledger historico.
5. Memoria ou narrativa.

