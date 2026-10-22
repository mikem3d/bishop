// Bundle the CLI and MCP server into standalone files, so a Mac only needs Node.
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

for (const name of ['cli', 'mcp']) {
  await build({
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    // Some dependencies still use require(); give ESM output a working one.
    banner: { js: "import { createRequire as __bishopRequire } from 'node:module'; const require = __bishopRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  await chmod(`dist/${name}.js`, 0o755);
}
console.log('built dist/cli.js and dist/mcp.js');
