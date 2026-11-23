import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Map relative imports to the .ts source, the way TypeScript's bundler
// resolution and Vite do: "./x" and "./x.js" both resolve to "./x.ts".
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const base = specifier.replace(/\.js$/, "");
      if (!/\.[cm]?[jt]sx?$/.test(base)) {
        const candidate = new URL(`${base}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
    }
    return next(specifier, context);
  },
});
