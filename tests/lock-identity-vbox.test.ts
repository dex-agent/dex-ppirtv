import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileIdentity } from "../src/store.js";
import { createTempRootRegistry } from "./temp-root-registry.js";

describe("meeting lock file identity por plataforma (VBOX)", () => {
  const roots = createTempRootRegistry();
  let dir: string;

  beforeAll(async () => {
    dir = await roots.create("ppirtv-lock-identity-");
  });

  afterAll(async () => {
    await roots.cleanup();
  });

  it("path normal: identidade dev:ino distingue troca de arquivo e fica estavel entre lstat", async () => {
    const lockA = path.join(dir, "flow-a.json.meeting.lock");
    const lockB = path.join(dir, "flow-b.json.meeting.lock");
    await writeFile(lockA, '{"owner_token":"token-a"}\n', "utf8");
    await writeFile(lockB, '{"owner_token":"token-a"}\n', "utf8");

    const before = await lstat(lockA, { bigint: true });
    const swapped = await lstat(lockB, { bigint: true });

    const identityBefore = fileIdentity(before, lockA);
    const identitySwapped = fileIdentity(swapped, lockB);

    expect(identityBefore).toBe(`${before.dev}:${before.ino}`);
    expect(identitySwapped).toBe(`${swapped.dev}:${swapped.ino}`);
    // Guard do readStableFlowLock compara identidades antes/depois: troca de
    // arquivo tem que produzir identidade diferente (lanca IDENTITY_CHANGED).
    expect(identityBefore).not.toBe(identitySwapped);

    // Estabilidade: reler o mesmo arquivo nao muda a identidade (sem falso positivo).
    const reread = await lstat(lockA, { bigint: true });
    expect(fileIdentity(reread, lockA)).toBe(identityBefore);
  });

  it("path VBoxSvr: inode instavel entre lstat nao gera falso MEETING_LOCK_IDENTITY_CHANGED", () => {
    const vboxLock = "\\\\VBoxSvr\\raiz-compartilhada\\repo\\.ppirtv\\flows\\flow-1.json.meeting.lock";
    const stableDev = 100n;
    const firstLstat = { dev: stableDev, ino: 111n };
    const secondLstat = { dev: stableDev, ino: 222n };

    const identityFirst = fileIdentity(firstLstat, vboxLock);
    const identitySecond = fileIdentity(secondLstat, vboxLock);

    expect(identityFirst).toBe(`dev:${stableDev}`);
    // Guard compara antes/depois no mesmo path VBoxSvr: inode oscilando nao
    // pode mudar a identidade.
    expect(identityFirst).toBe(identitySecond);
  });

  it("deteccao de path compartilhado e case-insensitive e so vale para VBoxSvr", () => {
    const lowerShare = "\\\\vboxsvr\\share\\repo\\lock.meeting.lock";
    const normalPath = "C:\\repo\\.ppirtv\\flows\\flow-1.json.meeting.lock";
    const info = { dev: 7n, ino: 42n };

    expect(fileIdentity(info, lowerShare)).toBe("dev:7");
    expect(fileIdentity(info, normalPath)).toBe("7:42");
  });
});
