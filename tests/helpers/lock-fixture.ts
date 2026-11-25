// Fixture PURA de disputa de lock em testes: nenhum efeito colateral na carga,
// pode ser importada por qualquer teste. O mock de node:fs/promises mora em
// fs-promises-mock.ts (que precisa ser o primeiro import do teste) e reexporta
// tudo daqui.
//
// Nasceu no Trilho E (2026-11-23): o predicado da criação do lock, a fábrica de
// errno e o pid do titular morto estavam copiados em três testes de lock.

/** Pid que nunca existe: titular de lock stale. */
export const PID_MORTO = 2147483647;

export function erroDeSistema(code: string, mensagem = `${code}: simulado`): NodeJS.ErrnoException {
  return Object.assign(new Error(mensagem), { code }) as NodeJS.ErrnoException;
}

/** A criação do lock é o writeFile com flag "wx" exatamente no caminho do lock. */
export function ehCriacaoDoLock(target: unknown, options: unknown, lockPath: string): boolean {
  return String(target) === lockPath && (options as { flag?: string } | undefined)?.flag === "wx";
}

/** Bytes de um arquivo de lock válido para o withFlowLock e para o withMutex. */
export function registroDeLock(owner_token: string, pid: number): string {
  return `${JSON.stringify({ owner_token, pid, created_at: new Date().toISOString() })}\n`;
}
