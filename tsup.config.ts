import { defineConfig } from "tsup";
export default defineConfig({ entry: ["src/cli.tsx"], format: ["esm"], target: "node20", banner: { js: "#!/usr/bin/env node" }, clean: true });
