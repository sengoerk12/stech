import { openWallet } from "./cafe/open-wallet";

async function main() {
  const action = process.argv[2];
  if (process.argv.length !== 3 || (action !== "--check" && action !== "--initialize-empty"))
    throw new Error("Choose --check or --initialize-empty");
  if (!process.env.WALLET_HTTPS_URL) throw new Error("WALLET_HTTPS_URL is required");
  const store = await openWallet(process.env, true);
  if (!store) throw new Error("Wallet connection is required");
  try {
    if (action === "--initialize-empty") await store.importOnce([]);
    console.log(JSON.stringify({ connected: true, ...(action === "--initialize-empty" ? { initialized: true } : {}) }));
  } finally {
    await store.close();
  }
}

void main().catch(error => {
  console.error("Wallet command failed:", error?.code ?? error?.message ?? "unknown");
  process.exitCode = 1;
});
