import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLocalDatabaseLease } from "../src/database/local-lease";
test("Local database lease rejects concurrent owners and can reopen after close", async () => {
  const root = await mkdtemp(join(tmpdir(), "stech-lease-"));
  const release = await acquireLocalDatabaseLease(root);
  await assert.rejects(acquireLocalDatabaseLease(root), /already open/);
  await release();
  await (
    await acquireLocalDatabaseLease(root)
  )();
});
test("Local database lease recovers only a verified dead owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "stech-stale-"));
  await mkdir(join(root, ".stech-owner"));
  await writeFile(
    join(root, ".stech-owner", "owner.json"),
    JSON.stringify({ pid: 2147483647, token: "dead-owner" }),
  );
  await (
    await acquireLocalDatabaseLease(root)
  )();
  const unknown = await mkdtemp(join(tmpdir(), "stech-unknown-"));
  await mkdir(join(unknown, ".stech-owner"));
  await assert.rejects(acquireLocalDatabaseLease(unknown), /already open/);
});
