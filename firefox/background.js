// Light MD Viewer - Background Service Worker
// Handles download requests from the content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    if (!sender || sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: 'Unauthorized sender' });
      return false;
    }

    if (!message.url || typeof message.url !== 'string' || !message.url.startsWith('blob:')) {
      sendResponse({ ok: false, error: 'Invalid download URL' });
      return false;
    }

    if (!message.filename || typeof message.filename !== 'string') {
      sendResponse({ ok: false, error: 'Invalid filename' });
      return false;
    }

    const safeFilename = message.filename.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '');
    if (!safeFilename) {
      sendResponse({ ok: false, error: 'Invalid filename' });
      return false;
    }

    chrome.downloads.download({
      url: message.url,
      filename: safeFilename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, downloadId: downloadId });
      }
    });
    return true; // keep message channel open for async sendResponse
  }
});
