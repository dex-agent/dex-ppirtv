import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createTempRootRegistry() {
  const roots = new Set<string>();
  const tempRoot = path.resolve(os.tmpdir());

  return {
    async create(prefix: string): Promise<string> {
      const root = await mkdtemp(path.join(tempRoot, prefix));
      roots.add(root);
      return root;
    },

    async cleanup(): Promise<void> {
      const pending = [...roots];
      const failures: unknown[] = [];
      for (const root of pending.reverse()) {
        try {
          assertOwnedTempRoot(tempRoot, root);
          await rm(root, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100
          });
          roots.delete(root);
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "PPIRTV_TEST_TEMP_ROOT_CLEANUP_FAILED");
      }
    }
  };
}

function assertOwnedTempRoot(tempRoot: string, root: string): void {
  const relative = path.relative(tempRoot, path.resolve(root));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`PPIRTV_TEST_TEMP_ROOT_OUTSIDE_OS_TMPDIR: ${root}`);
  }
}
