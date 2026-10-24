import esbuild from "esbuild";
import process from "process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// Obsidian loads one stylesheet: styles/base.css first, then every other sheet of
// styles/ in name order, joined into styles.css.
function buildStyles() {
	const sheets = readdirSync("styles").filter((f) => f.endsWith(".css") && f !== "base.css").sort();
	const css = ["base.css", ...sheets].map((f) => readFileSync(`styles/${f}`, "utf8").trim()).join("\n\n");
	writeFileSync("styles.css", css + "\n");
}
buildStyles();

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
