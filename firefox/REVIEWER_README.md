# Light MD Viewer — Source for AMO Reviewers

This archive contains the full source needed to reproduce the submitted XPI byte-for-byte (modulo `lib/mermaid.min.js`, which is verified against a pinned SHA-256 from the upstream npm package — see step 4).

## Hand-written vs generated files

**All files in this archive are hand-written.** No transpilation, bundling, or minification has been applied to any file shipped here.

The XPI also contains a `lib/` directory and `css/github-highlight.css`. **Those files are not in this archive** — they are produced by `npm run build` from the sources here. See "Build outputs" below for the mapping.

## Build environment

| Requirement | Version | Notes |
|---|---|---|
| Operating system | Linux, macOS, or Windows 10+ | Build is OS-agnostic (pure Node.js + npm) |
| Node.js | 18.x or newer (tested on 18.20, 20.x, 22.x) | https://nodejs.org/en/download |
| npm | 9.x or newer (ships with Node.js) | — |
| Disk | ~250 MB free for `node_modules/` | — |
| Network | Required for `npm install` and `npm pack mermaid` | Build is otherwise offline |

No global tools, compilers, or system packages are required. esbuild (the bundler) is a pinned npm `devDependency` and is installed locally by `npm install`.

## Reproduce the build

From the root of this archive, run **exactly** these three commands:

```sh
npm ci                          # install pinned dependencies from package-lock.json
npm run build:pin-hash          # downloads mermaid@11.4.1 from npm and prints its SHA-256
npm run build                   # bundles CodeMirror, marked, highlight.js; copies highlight.js CSS
```

Step 2 is only needed once per mermaid version — to confirm the SHA-256 pinned in `build.mjs` matches the bytes in the upstream npm release. The expected pinned value is in `build.mjs` (constant `MERMAID_SHA256`); step 2 prints the live hash so you can compare. After confirming, step 3 verifies the same bytes again before writing them to `lib/mermaid.min.js`.

(Use `npm ci` rather than `npm install` for a strictly reproducible install from `package-lock.json`.)

## Build outputs

After `npm run build`, the following files are produced and should match those in the submitted XPI byte-for-byte:

| Output file | Source | Tool |
|---|---|---|
| `lib/codemirror-bundle.js` | `src/editor.js` (+ `node_modules/codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data`) | esbuild (IIFE, minified, target chrome110) |
| `lib/marked.min.js` | `src/marked-global.js` (+ `node_modules/marked`) | esbuild (same options) |
| `lib/highlight.min.js` | `src/hljs-global.js` (+ `node_modules/highlight.js`) | esbuild (same options) |
| `lib/mermaid.min.js` | `dist/mermaid.min.js` extracted from `mermaid@11.4.1` npm tarball | `npm pack` + SHA-256 verification |
| `css/github-highlight.css` | `node_modules/highlight.js/styles/github.min.css` | direct file copy |

All other files in the XPI (`manifest.json`, `background.js`, `content.js`, `viewer.js`, `css/viewer.css`, `icons/*`) are **identical** to the corresponding files in this archive — no build step touches them.

## esbuild output reproducibility

esbuild produces deterministic output for a fixed input + version + options. The bundling options are defined in `build.mjs` (`sharedOptions`):

```js
{ bundle: true, format: 'iife', minify: true, sourcemap: false, target: ['chrome110'] }
```

`package-lock.json` pins esbuild to a specific resolved version, so `npm ci` installs the same compiler bytes as those used to produce the submitted XPI.

## File-by-file purpose

- `manifest.json` — Firefox MV3 manifest (with `browser_specific_settings.gecko`)
- `background.js` — event-page background script; relays download requests to `chrome.downloads`
- `content.js` — content script; detects raw `.md` files at `file://` URLs and injects the viewer UI
- `viewer.js` — main UI logic (rendering, editor, mode switching, export). Includes a tag/attribute allowlist HTML sanitizer (`sanitizeHtml`, line ~169) applied to all rendered markdown before it reaches the DOM.
- `css/viewer.css` — viewer styles (hand-written)
- `src/editor.js` — CodeMirror 6 entry point (imports a fixed Markdown configuration; never instantiates a JS/JSX language mode)
- `src/marked-global.js` — wraps `marked` as a browser global
- `src/hljs-global.js` — wraps `highlight.js` as a browser global
- `build.mjs` — the build script invoked by `npm run build`
- `package.json`, `package-lock.json` — pinned dependency manifest and resolution

## Security notes

- All third-party libraries are bundled locally; no network requests at runtime.
- A strict CSP `<meta>` tag is injected on every page (`content.js:69`) restricting scripts/styles to the extension origin (`default-src 'none'`). MV3 already withholds `'unsafe-eval'`.
- `host_permissions` is restricted to `file:///*/*.md` (and `.markdown`, `.mdown`) — no access to `<all_urls>` or web browsing data.
- The `Function()` warning in `lib/codemirror-bundle.js` comes from `@codemirror/lang-javascript`'s JSX attribute lexer, which is unreachable here — the editor is fixed to Markdown mode (see `src/editor.js`).

## Update policy

See `DEPENDENCIES.md` for the dependency inventory, version-pinning policy, and the SHA-256 update workflow for mermaid.
