import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database/database";
import { PersistentMockCafeAdapter } from "../src/cafe/persistent-mock";
import {
  MemberProfileService,
  normalizePhone,
  validNationalId,
} from "../src/profile/service";
import { createApp } from "../src/app";
import { ServiceUnavailableException } from "@nestjs/common";

test("Profile validation accepts formatted Turkish mobile numbers and valid ID checksum only", () => {
  assert.equal(normalizePhone("0532 123 45 67"), "+905321234567");
  assert.equal(normalizePhone("+90 (532) 123-45-67"), "+905321234567");
  assert.throws(() => normalizePhone("02121234567"));
  assert.equal(validNationalId("10000000146"), true);
  assert.equal(validNationalId("10000000145"), false);
  assert.equal(validNationalId(""), true);
});
test("Profile updates persist encrypted snapshots, retain multi-part names and recover a lost native response once", async () => {
  const db = await openDatabase();
  try {
    const cafe = new PersistentMockCafeAdapter(db, "test");
    await cafe.initialize();
    const member = await cafe.register({
      username: "profile_user",
      name: "Ali Test",
      phone: "05321234567",
      password: "OriginalPass123!",
    });
    const profiles = new MemberProfileService(db, cafe, "ab".repeat(32));
    const before = await profiles.get(member.id);
    const request = {
      operationId: randomUUID(),
      revision: before.revision,
      firstName: "Ali Can",
      lastName: "Şengör",
      phone: "05321234567",
      nationalId: "10000000146",
      address: "Test Mahallesi 14",
      currentPassword: "OriginalPass123!",
      newPassword: "ChangedPass123!",
    };
    const original = cafe.updateProfile.bind(cafe);
    let dropped = false;
    cafe.updateProfile = async (...args) => {
      await original(...args);
      if (!dropped) {
        dropped = true;
        throw new ServiceUnavailableException("Lost response");
      }
    };
    await assert.rejects(profiles.update(member.id, request));
    assert.equal(
      (await profiles.update(member.id, request)).passwordChanged,
      true,
    );
    await profiles.update(member.id, request);
    const after = await profiles.get(member.id);
    assert.equal(after.firstName, "Ali Can");
    assert.equal(after.lastName, "Şengör");
    assert.equal(after.nationalId, request.nationalId);
    assert.equal(after.address, request.address);
    assert.equal(
      await cafe.authenticate("profile_user", "OriginalPass123!"),
      null,
    );
    assert.equal(
      (await cafe.authenticate("profile_user", "ChangedPass123!"))?.id,
      member.id,
    );
    const changes = await db.query("SELECT * FROM member_profile_changes");
    assert.equal(changes.rows.length, 1);
    const saved = JSON.stringify(changes.rows);
    for (const secret of [
      request.currentPassword,
      request.newPassword,
      request.nationalId,
      request.address,
    ])
      assert.equal(saved.includes(secret), false);
    assert.equal((await profiles.history(member.id)).length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM audit_logs WHERE event='member.profile.changed'",
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      profiles.update(member.id, { ...request, address: "Different address" }),
    );
    await assert.rejects(new MemberProfileService(db, cafe).get(member.id));
  } finally {
    await db.close();
  }
});
test("Profile HTTP: current password, phone, immutable identity, account isolation and session revocation", async () => {
  const app = await createApp({
    ENVIRONMENT: "test",
    PROFILE_ENCRYPTION_KEY: "cd".repeat(32),
  });
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const call = async (
      path: string,
      body?: unknown,
      token?: string,
      method = body ? "POST" : "GET",
    ) =>
      fetch(url + "/api/v1/" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const registration = await call("auth/register", {
      username: "http_profile",
      name: "Üye Test",
      phone: "05321234567",
      password: "OriginalPass123!",
    });
    assert.equal(registration.status, 201);
    const tokens = await registration.json();
    const other = await (
      await call("auth/register", {
        username: "other_profile",
        name: "Diğer Üye",
        phone: "05331234567",
        password: "OtherPass123!",
      })
    ).json();
    const p = await (
      await call("me/profile", undefined, tokens.accessToken)
    ).json();
    const request = {
      operationId: randomUUID(),
      revision: p.revision,
      firstName: "Yeni",
      lastName: "Soyad",
      phone: "05321234567",
      nationalId: "",
      address: "Adres",
      currentPassword: "WrongPassword",
      newPassword: "NewPassword123!",
    };
    assert.equal(
      (await call("me/profile", request, tokens.accessToken, "PUT")).status,
      400,
    );
    assert.equal((await call('me/profile',{...request,currentPassword:undefined},tokens.accessToken,'PUT')).status,400);
    assert.equal((await call('me/profile',{...request,cardUid:'00123456'},tokens.accessToken,'PUT')).status,400);
    request.operationId = randomUUID();
    request.currentPassword = "OriginalPass123!";
    assert.equal(
      (
        await call(
          "me/profile",
          { ...request, memberNumber: "1" },
          tokens.accessToken,
          "PUT",
        )
      ).status,
      400,
    );
    const result = await call("me/profile", request, tokens.accessToken, "PUT");
    assert.equal(result.status, 200);
    assert.equal(
      (await call("me/dashboard", undefined, tokens.accessToken)).status,
      401,
    );
    const history = await (
      await call("me/profile/history", undefined, other.accessToken)
    ).json();
    assert.deepEqual(history, []);
    assert.equal((await call("me/profile")).status, 401);
    assert.equal(
      (
        await call("auth/login", {
          identifier: "http_profile",
          password: "OriginalPass123!",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("auth/login", {
          identifier: "http_profile",
          password: "NewPassword123!",
        })
      ).status,
      201,
    );
  } finally {
    await app.close();
  }
});
