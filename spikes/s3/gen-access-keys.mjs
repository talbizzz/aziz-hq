// Spike-only: makes a test keypair so the Access accept path can be tested without Cloudflare.
import { generateKeyPair, exportJWK } from "jose";
import { writeFileSync } from "node:fs";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
writeFileSync(".test-key.json", JSON.stringify({ ...(await exportJWK(privateKey)), kid: "spike", alg: "RS256" }));
writeFileSync(".access-jwks.json", JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "spike", alg: "RS256", use: "sig" }] }));
