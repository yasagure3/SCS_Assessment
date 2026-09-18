import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const result = await build({ entryPoints: ['report.mjs'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: 'output/report.browser.mjs', metafile: true });
const bundle = await fs.readFile('output/report.browser.mjs');
const stats = { bytes: bundle.length, gzipBytes: gzipSync(bundle).length, platform: 'browser', format: 'esm', target: 'es2022', externalImports: result.metafile.outputs['output/report.browser.mjs'].imports };
await fs.writeFile('output/bundle-result.json', JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats));
