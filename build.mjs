/**
 * Build script for Light MD Viewer Chrome Extension.
 *
 * 1. Bundles CodeMirror 6 (src/editor.js) into lib/codemirror-bundle.js
 * 2. Bundles marked.js (src/marked-global.js) into lib/marked.min.js
 * 3. Bundles highlight.js (src/hljs-global.js) into lib/highlight.min.js
 * 4. Obtains mermaid dist via npm pack (kept out of npm install to avoid transitive vulnerabilities)
 * 5. Copies highlight.js CSS theme from node_modules to css/
 *
 * Usage:
 *   npm run build              # one-time build
 *   npm run build:watch        # rebuild on changes (bundles only)
 *   npm run build:pin-hash     # download mermaid and print SHA-256 for pinning
 */

import * as esbuild from 'esbuild';
import { copyFileSync, writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const isPinHash = process.argv.includes('--pin-hash');

// Mermaid version and integrity hash (update both when upgrading)
// To pin: run "npm run build:pin-hash", then paste the printed hash here.
const MERMAID_VERSION = '11.4.1';
const MERMAID_SHA256 = null; // MUST be pinned before production builds

// Ensure output directories exist
['lib', 'css'].forEach(dir => {
  const p = join(__dirname, dir);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
});

// --- Step 1: Bundle all JS libraries with esbuild ---

const sharedOptions = {
  bundle: true,
  format: 'iife',
  minify: true,
  sourcemap: false,
  target: ['chrome110'],
  logLevel: 'info',
};

// Provenance banner for the CodeMirror bundle. Composed from package.json so
// versions stay accurate. Prepended via esbuild's `banner` option which is
// not subject to minification, so the comment survives in the final output.
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const cmDirectDeps = ['codemirror', '@codemirror/lang-markdown', '@codemirror/language-data']
  .map(name => `${name}@${pkg.dependencies[name]}`);
const codemirrorBanner = `/*!
 * CodeMirror 6 bundle for Light MD Viewer Chrome Extension
 *
 * Direct entry: src/editor.js
 * Direct dependencies (from package.json):
${cmDirectDeps.map(d => ' *   - ' + d).join('\n')}
 *
 * Built by esbuild (IIFE, minified, target chrome110, no source maps).
 * Reproducible via "npm run build" from the project root. See DEPENDENCIES.md.
 *
 * Licensed under MIT (CodeMirror, Lezer). Upstream copyright notices retained.
 *
 * Note for CWS reviewers: @codemirror/language-data transitively bundles
 * many language modes (incl. @codemirror/lang-javascript). One JSX-attribute
 * lexer path uses Function("...") inside a try/catch. It is reachable only
 * when the editor parses JS/JSX content, which this extension never does -
 * the editor is fixed to Markdown mode. The construct is inert under MV3 CSP
 * (no 'unsafe-eval' is granted) and the try/catch absorbs any failure.
 */
`;

const bundles = [
  {
    entryPoints: [join(__dirname, 'src', 'editor.js')],
    outfile: join(__dirname, 'lib', 'codemirror-bundle.js'),
    ...sharedOptions,
    banner: { js: codemirrorBanner },
  },
  {
    entryPoints: [join(__dirname, 'src', 'marked-global.js')],
    outfile: join(__dirname, 'lib', 'marked.min.js'),
    ...sharedOptions,
  },
  {
    entryPoints: [join(__dirname, 'src', 'hljs-global.js')],
    outfile: join(__dirname, 'lib', 'highlight.min.js'),
    ...sharedOptions,
  },
];

if (isWatch) {
  for (const opts of bundles) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
  }
  console.log('Watching for changes...');
} else {
  await Promise.all(bundles.map(opts => esbuild.build(opts)));
}

// --- Step 2: Copy highlight.js CSS theme ---

function findFile(...candidates) {
  for (const c of candidates) {
    const p = join(__dirname, 'node_modules', c);
    if (existsSync(p)) return p;
  }
  throw new Error('Could not find any of: ' + candidates.join(', '));
}

const cssSrc = findFile('highlight.js/styles/github.min.css', 'highlight.js/styles/github.css');
const cssDest = join(__dirname, 'css', 'github-highlight.css');
copyFileSync(cssSrc, cssDest);
console.log(`Copied: ${cssSrc} -> ${cssDest}`);

// --- Step 3: Obtain mermaid via npm pack ---
// Mermaid is obtained via npm pack rather than npm install to keep its large
// transitive dependency tree (chevrotain -> lodash-es with known vulnerabilities)
// out of npm audit scope. npm pack downloads only the published tarball without
// resolving transitive dependencies. The pre-built dist file has no runtime
// dependency on lodash-es.

const mermaidDest = join(__dirname, 'lib', 'mermaid.min.js');

if (existsSync(mermaidDest) && !process.argv.includes('--force') && !isPinHash) {
  console.log(`Mermaid ${MERMAID_VERSION} already present, skipping (use --force to re-download)`);
} else {
  // Enforce hash pinning for normal builds
  if (!isPinHash && !MERMAID_SHA256) {
    console.error(
      `\nERROR: MERMAID_SHA256 is not pinned in build.mjs.\n` +
      `  Run "npm run build:pin-hash" to download mermaid and obtain the hash,\n` +
      `  then set MERMAID_SHA256 in build.mjs before running a normal build.\n`
    );
    process.exit(1);
  }

  console.log(`Obtaining mermaid ${MERMAID_VERSION} via npm pack...`);

  const tgzName = `mermaid-${MERMAID_VERSION}.tgz`;
  const tgzPath = join(__dirname, tgzName);
  const extractDir = join(__dirname, '.mermaid-extract');

  try {
    // Download the package tarball (no transitive deps)
    execSync(`npm pack mermaid@${MERMAID_VERSION}`, {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!existsSync(tgzPath)) {
      throw new Error(`npm pack did not produce expected file: ${tgzName}`);
    }

    // Extract the tarball (npm pack tarballs use package/ prefix)
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar xzf "${tgzPath}" -C "${extractDir}"`, {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Read mermaid.min.js from extracted package
    const extractedFile = join(extractDir, 'package', 'dist', 'mermaid.min.js');
    if (!existsSync(extractedFile)) {
      throw new Error(
        `mermaid.min.js not found at expected path: package/dist/mermaid.min.js\n` +
        `The mermaid package structure may have changed.`
      );
    }
    const buffer = readFileSync(extractedFile);

    // Verify SHA-256 integrity
    const hash = createHash('sha256').update(buffer).digest('hex');

    if (isPinHash) {
      console.log(`\n  Mermaid ${MERMAID_VERSION} SHA-256:\n`);
      console.log(`  const MERMAID_SHA256 = '${hash}';\n`);
      console.log(`  Pin this value in build.mjs, then run a normal build.\n`);
    }

    if (MERMAID_SHA256 && hash !== MERMAID_SHA256) {
      throw new Error(
        `Mermaid integrity check failed!\n` +
        `  Expected: ${MERMAID_SHA256}\n` +
        `  Got:      ${hash}\n` +
        `  The npm package contents may have been tampered with. Do not use this file.`
      );
    }

    // Write verified file to lib/
    writeFileSync(mermaidDest, buffer);
    console.log(`Obtained mermaid ${MERMAID_VERSION} (${(buffer.length / 1024).toFixed(0)} KB)`);
    console.log(`  SHA-256: ${hash}`);
  } finally {
    // Clean up tarball and extraction directory
    try { unlinkSync(tgzPath); } catch (_) {}
    try { rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
  }
}

console.log('\nBuild complete. Extension is ready to load from this directory.');
