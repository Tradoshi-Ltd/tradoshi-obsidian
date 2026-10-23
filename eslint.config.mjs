import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "test/**"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*", "manifest.json", "package.json"],
				},
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", { brands: ["Tradoshi", "Obsidian", "Markdown"] }],
		},
	},
]);
