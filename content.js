// Light MD Viewer - Content Script
// Detects raw markdown files and replaces them with the rendered viewer UI

(function () {
  'use strict';

  // Only act on plain text content (raw markdown files)
  const ct = document.contentType;
  if (ct && ct !== 'text/plain' && ct !== 'text/markdown' && ct !== 'text/x-markdown') return;

  // Extract raw markdown from <pre> element (Chrome wraps plain text in <pre>)
  const pre = document.body.querySelector('pre');
  const rawMd = pre ? pre.textContent : document.body.innerText;
  if (!rawMd || !rawMd.trim()) return;

  // Get filename and path from URL
  const url = new URL(window.location.href);
  const pathParts = decodeURIComponent(url.pathname).split('/');
  const filename = pathParts.pop() || 'untitled.md';
  const folder = pathParts.join('/') || '/';
  const bridgeToken = createBridgeToken();

  // Pass data to main world via a hidden DOM element (shared between isolated and main worlds)
  const dataEl = document.createElement('script');
  dataEl.type = 'application/json';
  dataEl.id = '__light-md-data';
  dataEl.textContent = JSON.stringify({
    content: rawMd,
    filename: filename,
    folder: folder,
    bridgeToken: bridgeToken
  });

  // Clear and rebuild the document
  document.title = filename + ' - Light MD Viewer';

  while (document.head.firstChild) document.head.removeChild(document.head.firstChild);
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);

  // Add data element to head
  document.head.appendChild(dataEl);

  // Helper to get extension resource URLs
  const getUrl = chrome.runtime.getURL;

  // Inject CSS (CM6 injects its own styles via JS — no codemirror.css needed)
  const cssFiles = ['css/github-highlight.css', 'css/viewer.css'];
  cssFiles.forEach(function (path) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = getUrl(path);
    document.head.appendChild(link);
  });

  // Force UTF-8 encoding so scripts with Unicode (e.g. CodeMirror regex ranges) parse correctly
  const charset = document.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  document.head.insertBefore(charset, document.head.firstChild);

  // Add viewport meta
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = 'width=device-width, initial-scale=1.0';
  document.head.appendChild(meta);

  // Content Security Policy: only allow scripts/styles from the extension bundle.
  // base-uri and object-src are not covered by default-src and must be set explicitly.
  const cspMeta = document.createElement('meta');
  cspMeta.httpEquiv = 'Content-Security-Policy';
  cspMeta.content = "default-src 'none'; script-src " + getUrl('/') +
    "; style-src " + getUrl('/') + " 'unsafe-inline'" +
    "; img-src file: data: blob: https:" +
    "; font-src " + getUrl('/') +
    "; base-uri 'none'" +
    "; object-src 'none';";
  document.head.appendChild(cspMeta);

  // Build toolbar and container HTML
  document.body.innerHTML =
    '<div class="toolbar">' +
      '<div class="toolbar-left">' +
        '<div class="filename">' + escapeHtml(filename) + '</div>' +
        '<div class="path" title="' + escapeHtml(folder) + '">' + escapeHtml(folder) + '</div>' +
      '</div>' +
      '<div class="toolbar-center">' +
        '<button id="btnView" class="active" data-action="view">View</button>' +
        '<button id="btnEdit" data-action="edit">Edit</button>' +
        '<button id="btnSplit" data-action="split">Split</button>' +
      '</div>' +
      '<span id="saveStatus" class="save-status"></span>' +
      '<div class="toolbar-right">' +
        '<button id="btnSave" class="save-primary" data-action="save">Save</button>' +
        '<button id="btnDownload" class="save-btn" data-action="download">Download</button>' +
        '<button id="btnCopyHtml" class="export-btn" data-action="copyHtml">Copy HTML</button>' +
        '<button id="btnCopyMd" class="export-btn" data-action="copyMd">Copy MD</button>' +
        '<button id="btnDarkMode" class="theme-toggle" data-action="toggleDark">Dark</button>' +
      '</div>' +
    '</div>' +
    '<div class="container">' +
      '<div class="rendered" id="rendered"></div>' +
      '<div class="raw-view" id="rawView">' +
        '<div id="editorHost"></div>' +
      '</div>' +
    '</div>';

  // Load library scripts sequentially (order matters for dependencies)
  // CM6 is a single bundle — replaces the 6 separate CM5 files
  var libs = [
    'lib/marked.min.js',
    'lib/highlight.min.js',
    'lib/mermaid.min.js',
    'lib/codemirror-bundle.js',
    'viewer.js'
  ];

  loadScriptsSequentially(libs, 0);

  // Relay download requests from main world (viewer.js) to background service worker.
  // viewer.js runs in the main world where chrome.runtime is unavailable,
  // so it uses window.postMessage to reach this content script instead.
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__light-md-download') return;
    if (event.data.token !== bridgeToken) return;

    chrome.runtime.sendMessage({
      action: 'download',
      url: event.data.url,
      filename: event.data.filename
    }, function (response) {
      window.postMessage({
        type: '__light-md-download-response',
        token: bridgeToken,
        requestId: event.data.requestId,
        response: response || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message }
      }, '*');
    });
  });

  function loadScriptsSequentially(paths, index) {
    if (index >= paths.length) return;
    var script = document.createElement('script');
    script.charset = 'utf-8';
    script.src = getUrl(paths[index]);
    script.onload = function () {
      loadScriptsSequentially(paths, index + 1);
    };
    script.onerror = function () {
      console.error('Light MD Viewer: Failed to load ' + paths[index]);
      // Continue loading remaining scripts (viewer.js handles missing libs gracefully)
      loadScriptsSequentially(paths, index + 1);
    };
    document.body.appendChild(script);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createBridgeToken() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }
})();
