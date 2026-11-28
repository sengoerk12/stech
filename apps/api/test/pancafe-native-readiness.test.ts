import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PanCafeBridgeClient, PanCafeSystemAdapter } from "../src/cafe/pancafe";
import { openDatabase } from "../src/database/database";

test("native payment preflight preserves the bridge's connection error and only checks readiness", async () => {
  const db = await openDatabase();
  const paths: string[] = [];
  const config = { installationId: "native-test", displayName: "Test", apiKey: "x".repeat(48) };
  let response: Record<string, string> = { READY: "false", MESSAGE: "PanCafe bağlantısı hazır değil." };
  const bridge = new PanCafeBridgeClient(config, undefined, async input => {
    paths.push(new URL(String(input)).pathname);
    return Response.json([response]);
  });
  const cafe = new PanCafeSystemAdapter(db, bridge, config);
  try {
    await assert.rejects(() => cafe.assertCreditReady(), { message: response.MESSAGE });
    response = { READY: "false" };
    await assert.rejects(() => cafe.assertCreditReady(), /otomatik üye bonusu kapatılmalı/);
    response = { READY: "true" };
    await cafe.assertCreditReady();
    assert.deepEqual(paths, ["/credit/readiness", "/credit/readiness", "/credit/readiness"]);
  } finally {
    await db.close();
  }
});
