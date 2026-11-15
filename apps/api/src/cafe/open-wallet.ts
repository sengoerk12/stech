import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HttpWallet } from "./http-wallet";
import { MysqlWallet } from "./mysql-wallet";

export async function openWallet(env: NodeJS.ProcessEnv, forImport = false) {
  if (env.WALLET_HTTPS_URL && env.WALLET_MYSQL_URL)
    throw new Error("Configure one wallet connection");
  if (env.WALLET_HTTPS_URL) {
    if (!env.WALLET_HTTPS_PRIVATE_KEY_FILE) throw new Error("Wallet signing key file is required");
    if (process.platform !== "win32") throw new Error("The hosted wallet signing key requires Windows");
    const key = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
      "$ErrorActionPreference = 'Stop'",
      "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')",
      "$sealed = [IO.File]::ReadAllBytes($env:STECH_WALLET_KEY_PATH)",
      "$key = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'CurrentUser')",
      "try { [Console]::Write([Text.Encoding]::UTF8.GetString($key)) } finally { [Array]::Clear($key, 0, $key.Length) }",
    ].join("; ")], {
      env: { ...process.env, STECH_WALLET_KEY_PATH: env.WALLET_HTTPS_PRIVATE_KEY_FILE },
      timeout: 8000, maxBuffer: 16384, windowsHide: true,
    }).catch(() => { throw new Error("Could not open the signing key under this Windows account"); });
    return HttpWallet.open(env.WALLET_HTTPS_URL, key.stdout, forImport);
  }
  if (env.WALLET_MYSQL_URL) {
    const ca = env.WALLET_MYSQL_CA_FILE ? await readFile(env.WALLET_MYSQL_CA_FILE, "utf8") : undefined;
    return MysqlWallet.open(env.WALLET_MYSQL_URL, ca, forImport);
  }
  return null;
}
