import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowEngine } from "../src/flow-engine.js";
import { PpirtvStore } from "../src/store.js";
import { scrubSecretLike, isSecretLikeText, scrubSecretLikeText } from "../src/security/secret-redaction.js";

let tempRoot: string;
let engine: FlowEngine;
let store: PpirtvStore;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "security-test-"));
  store = new PpirtvStore(tempRoot);
  await store.init();
  engine = new FlowEngine(store);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("secret redaction SSOT", () => {
  it("detects sk-... bare token by content", () => {
    expect(isSecretLikeText("sk-live-abc123xyz789")).toBe(true);
    expect(isSecretLikeText("sk-test-qwertyuiop1234")).toBe(true);
    expect(isSecretLikeText("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890")).toBe(true);
  });

  it("detects Bearer token by content", () => {
    expect(isSecretLikeText("Bearer eyJhbGciOiJIUzI1NiJ9.test")).toBe(true);
  });

  it("detects api_key=value by content", () => {
    expect(isSecretLikeText("api_key=AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("detects GitHub and GitLab personal access tokens by content", () => {
    expect(isSecretLikeText("ghp_abcdefghijklmnop1234567890")).toBe(true);
    expect(isSecretLikeText("github_pat_abcdefghijklmnopqrstuvwxyz1234567890_ABCD")).toBe(true);
    expect(isSecretLikeText("glpat-abcdefghijklmnop1234567890")).toBe(true);
  });

  it("does not flag normal text", () => {
    expect(isSecretLikeText("objetivo normal do fluxo")).toBe(false);
    expect(isSecretLikeText("npm run check")).toBe(false);
  });

  it("scrubs string with secret to [redacted]", () => {
    expect(scrubSecretLikeText("usar Bearer eyJhbGciOiJIUzI1NiJ9.test")).toBe("[redacted]");
    expect(scrubSecretLikeText("usar ghp_abcdefghijklmnop1234567890")).toBe("[redacted]");
    expect(scrubSecretLikeText("usar github_pat_abcdefghijklmnopqrstuvwxyz1234567890_ABCD")).toBe("[redacted]");
    expect(scrubSecretLikeText("usar sk-proj-abcdefghijklmnopqrstuvwxyz1234567890")).toBe("[redacted]");
    expect(scrubSecretLikeText("texto normal")).toBe("texto normal");
  });

  it("scrubs nested object by key name AND content", () => {
    const input = {
      goal: "testar com sk-live-abc123xyz789",
      password: "minhasenha",
      normal: "texto normal"
    };
    const result = scrubSecretLike(input);
    expect(result.goal).toBe("[redacted]");
    expect(result.password).toBe("[redacted]");
    expect(result.normal).toBe("texto normal");
  });
});

describe("#1 secret in free-text does not leak to ledger", () => {
  it("createFlow with sk-... in goal redacts in ledger (border output)", async () => {
    // Bug #1: scrubSecrets redige por nome de chave, nao por conteudo.
    // Um token sk-... em goal (campo livre) ia para ledger.ndjson sem redação.
    // Agora scrubSecretLike (SSOT) redaciona por conteudo na borda de saida
    // (ledger). O flow JSON interno mantem o original para o fiscal policy.
    const flow = await engine.createFlow({
      goal: "Testar usando sk-live-abc123xyz789 no objetivo"
    });

    // Ler o ledger em disco e verificar se o segredo foi redatado.
    const ledgerText = await readFile(store.ledgerPath, "utf8");
    expect(ledgerText).not.toContain("sk-live-abc123xyz789");
    expect(ledgerText).toContain("[redacted]");
  });
});

describe("#2 readLedger tolerates corrupted lines", () => {
  it("does not crash when ledger has a malformed line", async () => {
    // Bug #2: readLedger faz JSON.parse sem try/catch por linha.
    const ledgerPath = store.ledgerPath;
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    // Escrever ledger com 2 linhas validas + 1 corrompida.
    await writeFile(
      ledgerPath,
      [
        '{"type":"flow_created","data":{"goal":"ok"}}',
        '{"type":"gate_checked","data":{"phase":"pensamentos"}}',
        "{corrupted line without proper json",
        '{"type":"flow_completed","data":{"from":"pensamentos"}}'
      ].join("\n") + "\n",
      "utf8"
    );

    // readLedger deve retornar apenas as linhas validas, sem lancar.
    const events = await store.readLedger();
    expect(events.length).toBe(3);
    expect(events.every((e) => e && typeof e === "object")).toBe(true);
  });
});

describe("#3 writeJsonAtomic uses unique temp file", () => {
  it("does not use a fixed .tmp suffix (uses randomUUID)", async () => {
    // Bug #3: writeJsonAtomic usa ${filePath}.tmp fixo, causando race.
    // Verificar que o temp tem um sufixo unico (UUID).
    // Como writeJsonAtomic é interno, testamos indiretamente: se dois saves
    // concorrentes nao colidem no temp, o resultado esta correto.
    const flow = await engine.createFlow({ goal: "temp race test" });
    const flow2 = await engine.createFlow({ goal: "temp race test 2" });

    // Simular duas escritas concorrentes no MESMO arquivo.
    await Promise.all([
      store.saveFlow({ ...flow, goal: "concurrent-1" }),
      store.saveFlow({ ...flow, goal: "concurrent-2" })
    ]);

    // Se o temp fosse fixo, uma escrita poderia renomear o temp da outra.
    // O resultado final deve ser um dos dois, nao um estado corrompido.
    const loaded = await store.loadFlow(flow.flow_id);
    expect(["concurrent-1", "concurrent-2"]).toContain(loaded.goal);

    // Confirmar que flow2 tambem foi salvo corretamente (nao corrompido).
    const loaded2 = await store.loadFlow(flow2.flow_id);
    expect(loaded2.goal).toBe("temp race test 2");
  });
});
