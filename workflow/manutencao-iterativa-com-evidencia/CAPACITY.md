---
schema: dex.workflow.capacity.v1
fotografia_id: ppirtv-manutencao-20261102
fotografia_date: '2026-11-02'
---

# CAPACITY - manutencao-iterativa-com-evidencia

## Capacidades comprovadas

| # | Capacidade | Oracle | Evidência | Status |
|---|---|---|---|---|
| 1 | Instancia local com linhagem e regras | checker oficial --delivery repo | findings=[]; global1.1.0 e local1.0.0 distintos | executado_ao_vivo |
| 2 | Consumo de CRG e medidor owners | exporter real + raw v2 + receipts | baseline e implantacao01/02; perfil report_only | parcial |
| 3 | Falhas deixam evidencia e baseline nao sobrescreve | testes fronteira5/5 + RED ferramenta ausente | logs/receipt create-only | executado_ao_vivo |

## Laudo

- Confirmadas: pacote e comandos realmente consumidos; bancos nao duplicados; ferramentas compartilhadas preservadas nos owners.
- Parciais: CRG2255/36038 com23879 endpoints unresolved; metricas TS com repro de extracao suspeita e nesting3measured/1partial. Raw nao equivale a numero correto universal.
- Nao medidas: cobertura90/80, ciclos e ganho longitudinal de manutencao de produto. Dois cortes de implantacao nao substituem dois cortes de codigo independentes.
- Provas: USAGE.md e .agents/receipts/manutencao-continua-20261102; nenhuma operacao fiscal executada.

## Reavaliacao

- Quando: proximo corte de codigo autorizado, mudanca de config/provider/medidor ou correcao do scanner.
- Owner: executor do corte; medidor owner responde pela fixture antes de depender de seus valores afetados.
