/**
 * E2E-only bridge (excluded from normal builds in wxt.config.ts).
 * Firefox's WebDriver cannot script extension pages, so the Firefox suite drives Tablar from a
 * local test page: window.postMessage → this content script → runtime.sendMessage.
 */
export default defineContentScript({
  matches: ['http://127.0.0.1/*'],
  main() {
    document.documentElement.dataset.tablarBridge = 'ready';
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data as { tablarE2E?: number; msg?: unknown } | null;
      if (!data || typeof data.tablarE2E !== 'number') return;
      browser.runtime
        .sendMessage(data.msg)
        .then((res) => window.postMessage({ tablarE2EReply: data.tablarE2E, res }, '*'))
        .catch((e) =>
          window.postMessage(
            { tablarE2EReply: data.tablarE2E, res: { ok: false, error: String(e) } },
            '*',
          ),
        );
    });
  },
});
