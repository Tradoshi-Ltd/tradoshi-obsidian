import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tradoshi-offer-"));
const out = join(dir, "offer-rule.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/offer-rule.ts"], bundle: true, format: "esm", write: false }).outputFiles[0].text);
const o = await import(pathToFileURL(out).href);

test("each plan includes the ones below it, as on the pricing page", () => {
	assert.equal(o.includes("premium", "pro"), true);
	assert.equal(o.includes("premium", "essentiel"), true);
	assert.equal(o.includes("pro", "pro"), true);
	assert.equal(o.includes("pro", "premium"), false);
	assert.equal(o.includes("essentiel", "pro"), false);
	assert.equal(o.includes("essentiel", "essentiel"), true);
	assert.equal(o.includes("gratuit", "essentiel"), false);
	assert.equal(o.includes("gratuit", "gratuit"), true);
});

test("a plan never read, or unknown, opens only the free features", () => {
	for (const code of [undefined, null, "", "business", 3, "PRO"]) {
		assert.equal(o.normalizeOffer(code), "gratuit");
		assert.equal(o.includes(code, "essentiel"), false);
	}
	assert.equal(o.normalizeOffer("pro"), "pro");
});
