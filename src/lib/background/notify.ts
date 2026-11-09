import { browser } from 'wxt/browser';

/** Notifications are an optional permission; this is a no-op unless the user granted it. */
export async function notifyAutoSuspended(count: number): Promise<void> {
  try {
    const granted = await browser.permissions.contains({ permissions: ['notifications'] });
    if (!granted || !browser.notifications?.create) return;
    await browser.notifications.create('tablar-auto', {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: 'Tablar',
      message: count === 1 ? 'Suspended 1 inactive tab.' : `Suspended ${count} inactive tabs.`,
    });
  } catch (e) {
    console.warn('[Tablar] notification failed', e);
  }
}
