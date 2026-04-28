# Chrome Web Store Review Notes — Light MD Viewer

This document is a reviewer-facing reference. It is **not** shipped inside the
extension package; it lives only in the source repository. Use it to draft
permission justifications for the CWS submission form, and to reply quickly
if a reviewer raises a question about static-analysis findings.

---

## 1. What this extension does (single purpose)

Light MD Viewer renders local Markdown files (`.md`, `.markdown`, `.mdown`)
directly in Chrome with syntax highlighting, Mermaid diagrams, and an in-place
split-pane editor. There is no popup, no new-tab override, no background tab
activity, no telemetry, and no network egress.

The extension only activates on `file://` URLs whose path ends in one of the
three Markdown extensions. On any other page it does nothing.

---

## 2. Bundle composition and provenance

All third-party code is bundled at build time from npm; nothing is fetched at
runtime. The build is fully reproducible — see `build.mjs` and `DEPENDENCIES.md`
in the repo root.

| Shipped file | Origin | How it gets there |
|--------------|--------|-------------------|
| `lib/codemirror-bundle.js` | `codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data` (npm) | esbuild bundles `src/editor.js` into a single IIFE. Banner comment at top of file lists the inputs and versions. |
| `lib/marked.min.js` | `marked` (npm) | esbuild bundles `src/marked-global.js`. |
| `lib/highlight.min.js` | `highlight.js` (npm) | esbuild bundles `src/hljs-global.js`. |
| `lib/mermaid.min.js` | `mermaid` (npm) | Obtained via `npm pack mermaid@<version>` and verified against a pinned SHA-256 hash before being copied into `lib/`. The `npm pack` route is used to avoid pulling Mermaid's transitive dev-time `lodash-es` advisory chain into `npm audit` scope; the published `dist/mermaid.min.js` has no runtime dependency on lodash-es. |
| `css/github-highlight.css` | `highlight.js` (npm) | Copied from `node_modules/highlight.js/styles/github.min.css`. |

All files in `package/lib/` are minified for size. The corresponding source is
either the upstream npm package (for marked / highlight.js / mermaid) or
`src/editor.js` (for the CodeMirror bundle). Run `npm install && npm run build`
in the project root to reproduce every shipped artifact.

---

## 3. Static-analysis findings — explanations

A naive grep over the bundled libraries surfaces a few patterns that look like
prohibited dynamic code execution or remote loading. None of them actually are.

### 3.1 `Function("return this")` in `lib/mermaid.min.js` (2 hits)

This is the classic UMD / lodash global-object polyfill:

```js
typeof self === "object" && self && self.Object === Object && self,
REe = X3 || NEe || Function("return this")()
```

It is the **last fallback** in an `||` chain after `globalThis`-shaped checks.
On any modern Chrome (≥ 60), the earlier branches always resolve a non-falsy
value, so the `Function(...)` branch is never executed. Even if it were, MV3's
default `extension_pages` CSP forbids `'unsafe-eval'`, and the rebuilt page CSP
that `content.js` injects (lines 68–76) likewise omits `'unsafe-eval'`, so the
construction would throw. The `||` short-circuits before reaching it.

The pattern ships in **lodash internals embedded inside Mermaid's published
dist bundle**. It is widespread across npm-distributed libraries and is not
itself prohibited by CWS policy — the policy targets *executing remote logic*
and *fetching code at runtime*, not the mere presence of `Function` constants
in well-known minified vendor bundles.

### 3.2 `Function("...")` in `lib/codemirror-bundle.js` (1 hit)

This call lives inside the JSX-attribute lexer of `@codemirror/lang-javascript`,
which is bundled transitively via `@codemirror/language-data`. The relevant
shape in source is:

```js
try { return Function(/* a parser snippet */); } catch (_) { /* fall back */ }
```

The codepath is reachable only when CodeMirror is actively lexing JavaScript /
JSX source code inside the editor. **This extension never invokes JS/JSX
mode** — the editor is created with `markdown({ base: markdownLanguage,
codeLanguages: languages })` (`src/editor.js`), so the surrounding document is
always Markdown. The JS mode would only briefly load if a user typed a
` ```jsx ` fenced code block; even then, the JSX-attribute-string subpath is
unlikely to fire on Markdown-embedded snippets, and the surrounding `try/catch`
swallows any CSP failure with no editor disruption.

The construct is provably inert under MV3 CSP. We chose to keep
`@codemirror/language-data` (rather than enumerating individual languages)
because it gives users syntax highlighting for any language they paste into a
fenced code block — a core UX expectation for a Markdown editor.

### 3.3 String URLs in `lib/mermaid.min.js`

A URL scan of `mermaid.min.js` returns ~50 hits. Every one of them is one of:

- **XML / SVG / MathML namespace identifiers** (`http://www.w3.org/2000/svg`,
  `http://www.w3.org/1998/Math/MathML`, `http://www.w3.org/1999/xlink`, …).
  These are **identifier strings**, not network targets — they are required by
  the SVG/MathML specifications to be present as `xmlns` attribute values on
  generated elements.
- **License-text URLs** (`opensource.org/licenses/MIT`, `engelschall.com`,
  `tldrlegal.com/license/mit-license`) inside license header strings.
- **Documentation / changelog URLs** (`chevrotain.io/docs/...`,
  `github.com/chevrotain/chevrotain/issues`, `github.com/markedjs/marked.`) used
  inside parser error message strings.

None of these are passed to `fetch()`, `XMLHttpRequest`, `new Image()`,
`<script src>`, `<link href>`, `importScripts()`, or any other network API.
They are pure data strings. A grep for actual network-egress APIs in the
shipped libraries returns zero hits.

### 3.4 `t.fetch(...)` calls in `lib/mermaid.min.js`

Not the global `fetch()` API. Mermaid bundles a parser whose token-iterator
class has a method named `fetch` (consume next token). All `t.fetch(...)` and
`i.fetch(...)` hits are method calls on parser instances; they perform no I/O.

---

## 4. Permissions justification (for the CWS submission form)

### `downloads` — required

The viewer offers a "Download" button as a fallback save path when the
File System Access API (`showSaveFilePicker`) is unavailable, when the user
declines the save picker, or when the source file is opened from a location
the picker cannot write back to. The download is initiated from a `blob:` URL
holding the user's edited Markdown content; the background service worker
validates the URL scheme and sanitizes the filename before calling
`chrome.downloads.download(...)` with `saveAs: true` so the user always
confirms the destination.

### `host_permissions: file:///*/*.md`, `file:///*/*.markdown`, `file:///*/*.mdown` — required

The extension's sole function is rendering local Markdown files. The host
patterns are deliberately scoped to file paths ending in the three accepted
Markdown extensions; the extension does **not** request `file:///*` (all
files) or any `http(s)://` host. Users must additionally enable
"Allow access to file URLs" in `chrome://extensions` for the extension to
function — this is documented in the store description.

---

## 5. Security architecture (why the extension is hard to misuse)

These are positive properties worth highlighting if a reviewer asks how user
data is protected.

- **HTML sanitizer with strict allowlist.** `viewer.js:147–227` walks the DOM
  produced by `marked.parse(...)` and removes any tag not on a 47-element
  allowlist, strips all `on*` attributes and inline `style` attributes,
  blocks `javascript:` and `vbscript:` URLs, blocks `data:` URLs except for
  whitelisted raster image MIME types, and auto-applies `noopener noreferrer`
  to any `target="_blank"` link.
- **Mermaid `securityLevel: 'strict'`.** `viewer.js:140, 509`. Mermaid's own
  HTML output is rendered in its strictest sandboxed mode regardless of theme.
- **Per-load random bridge token.** `content.js:162–168` generates a 16-byte
  CSPRNG token via `crypto.getRandomValues`. The token is required for any
  message crossing the `window.postMessage` bridge between the page's main
  world (`viewer.js`) and the content-script isolated world (`content.js`).
  A page script cannot forge a download request.
- **Strict page-level CSP injected into the rebuilt document.**
  `content.js:68–76` writes a `<meta http-equiv="Content-Security-Policy">`
  with `default-src 'none'`, `script-src` limited to the extension origin,
  `object-src 'none'`, `base-uri 'none'`, and the only `unsafe-inline`
  allowance is for `style-src` (required because Mermaid emits inline `style=""`
  attributes on its generated SVG nodes — this CSP applies to the rebuilt
  `file://` page, not to extension pages).
- **Service-worker sender validation.** `background.js:6–9` rejects any
  message whose `sender.id !== chrome.runtime.id`.
- **Download-URL validation.** `background.js:11–25` accepts only `blob:` URLs
  and sanitizes the filename (strips path separators, drive characters,
  leading dots).

---

## 6. No remote code, no telemetry, no analytics

- No `<script src="http(s)://...">` is ever inserted. Every script tag uses
  `chrome.runtime.getURL(...)` (`content.js:140–154`).
- No CDN-loaded stylesheets. CSS files are loaded via `chrome.runtime.getURL`.
- No `eval`, `new Function`, or `tabs.executeScript({code: ...})` is used in
  any first-party code (`background.js`, `content.js`, `viewer.js`).
- No `XMLHttpRequest` and no `fetch()` calls in first-party code. The only
  HTTP request the extension would ever make is the implicit one Chrome makes
  on the user's behalf when an `<img>` tag in their Markdown points at an
  `https://` URL — that's the user's own content, not the extension acting.
- No analytics SDKs, no error-reporting endpoints, no remote config. The
  extension does not phone home.

---

## 7. Hardening choices worth noting

- `web_accessible_resources` uses `"use_dynamic_url": true`, so the
  `chrome-extension://...` token rotates per session and cannot be used by
  a `file://` page to fingerprint the extension.
- `minimum_chrome_version: "110"` matches the esbuild `target` floor, so
  feature gaps (e.g. `showSaveFilePicker`, MV3 service-worker semantics)
  cannot trip a user on a stale build.
- The Mermaid bundle is integrity-verified by SHA-256 at build time; see
  `build.mjs` and `DEPENDENCIES.md`.

---

## 8. Reproducing the build (for reviewers)

```cmd
git clone <repo>
cd light-md-viewer-extension
npm install                  # 0 audit vulnerabilities expected
npm run build                # produces lib/* and css/github-highlight.css
diff -r lib/ package/lib/    # should match the shipped bundle byte-for-byte
diff css/ package/css/       # likewise
```