import { browser } from 'wxt/browser';
import type { Envelope, Request, ResponseMap } from '../messages';

/** Typed request to the background. Throws with the background's error message on failure. */
export async function call<T extends Request>(req: T): Promise<ResponseMap[T['type']]> {
  const res = (await browser.runtime.sendMessage(req)) as
    Envelope<ResponseMap[T['type']]> | undefined;
  if (!res) throw new Error('Tablar background is not responding. Try reopening this page.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
