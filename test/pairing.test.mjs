import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-pairing-"));
const out = join(dir, "pairing.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/pairing.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const P = await import(pathToFileURL(out).href);

test("a token sealed by Tradoshi with the public key opens with the private key", async () => {
	const pairing = await P.newPairing();
	assert.match(pairing.id, /^[A-Za-z0-9_-]{22,64}$/);
	assert.match(pairing.publicKey, /^[A-Za-z0-9_-]{200,1200}$/);
	// What the app does: import the key from the address, encrypt the token, send base64.
	const key = await webcrypto.subtle.importKey("spki", P.fromBase64(pairing.publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
	const token = "tsr_ABCDEFGHJKMNPQRSTUVWXYZ23456789ABCDEFGHJKMNPQRSTUVW";
	const sealed = Buffer.from(await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(token))).toString("base64");
	assert.ok(sealed.length >= 100 && sealed.length <= 2000);
	assert.equal(await P.openSealed(pairing.privateKey, sealed), token);
});

test("another vault cannot open it", async () => {
	const mine = await P.newPairing();
	const other = await P.newPairing();
	const key = await webcrypto.subtle.importKey("spki", P.fromBase64(mine.publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
	const sealed = Buffer.from(await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode("tsr_X"))).toString("base64");
	await assert.rejects(() => P.openSealed(other.privateKey, sealed));
});
