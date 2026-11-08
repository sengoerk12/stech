import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  rmdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/** PGlite is single-process. Its PostgreSQL PID is virtual, not a host lock. */
export async function acquireLocalDatabaseLease(
  directory: string,
): Promise<() => Promise<void>> {
  const root = resolve(directory),
    lock = join(root, ".stech-owner"),
    guard = join(root, ".stech-recovery");
  await mkdir(root, { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "owner.json"), JSON.stringify(owner), {
        flag: "wx",
      });
      return async () => {
        const current = JSON.parse(
          await readFile(join(lock, "owner.json"), "utf8"),
        );
        if (current.token !== owner.token)
          throw new Error("Local database lease changed unexpectedly.");
        await unlink(join(lock, "owner.json"));
        await rmdir(lock);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const busy = () =>
        new Error(
          "Local database is already open or its owner could not be verified. Close the other S TECH server before starting another.",
        );
      let held: { pid: number; token: string };
      try {
        held = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
      } catch {
        throw busy();
      }
      if (
        !Number.isSafeInteger(held.pid) ||
        held.pid < 1 ||
        typeof held.token !== "string"
      )
        throw busy();
      try {
        process.kill(held.pid, 0);
        throw busy();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw busy();
      }
      // Serialize stale-owner recovery. Keep the old owner record for diagnostics.
      try {
        await mkdir(guard);
      } catch {
        throw busy();
      }
      try {
        const current = JSON.parse(
          await readFile(join(lock, "owner.json"), "utf8"),
        );
        if (current.token !== held.token) throw busy();
        await rename(lock, join(root, `.stech-owner-stale-${randomUUID()}`));
      } finally {
        await rmdir(guard);
      }
    }
  }
  throw new Error("Local database lease unavailable.");
}
