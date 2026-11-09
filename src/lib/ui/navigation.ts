import { browser } from 'wxt/browser';

export async function openDashboard(section?: string): Promise<void> {
  const url = browser.runtime.getURL('/dashboard.html') + (section ? `#${section}` : '');
  const [existing] = await browser.tabs.query({
    url: browser.runtime.getURL('/dashboard.html') + '*',
  });
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined)
      await browser.windows.update(existing.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url });
  }
}
