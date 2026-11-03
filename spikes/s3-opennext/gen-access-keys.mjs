// Spike-only: makes a test keypair so /api/ping's accept path can be tested without Cloudflare.
import { generateKeyPair, exportJWK } from "jose";
import { writeFileSync, readFileSync } from "node:fs";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const pub = { ...(await exportJWK(publicKey)), kid: "spike", alg: "RS256", use: "sig" };
const priv = { ...(await exportJWK(privateKey)), kid: "spike", alg: "RS256" };
writeFileSync(".test-key.json", JSON.stringify(priv));
const env = readFileSync(".env.local", "utf8").split("\n").filter((l) => l && !l.startsWith("ACCESS") && !l.startsWith("CF_"));
env.push("CF_ACCESS_TEAM_DOMAIN=spiketeam", "CF_ACCESS_AUD=spike-aud", `ACCESS_JWKS_JSON=${JSON.stringify({ keys: [pub] })}`);
writeFileSync(".dev.vars", env.join("\n") + "\n");
