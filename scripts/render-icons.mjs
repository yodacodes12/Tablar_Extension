// Renders src/assets/logo.svg to public/icon/{16,32,48,96,128}.png using Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const svg = await readFile(new URL('../src/assets/logo.svg', import.meta.url), 'utf8');
await mkdir(new URL('../public/icon/', import.meta.url), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/icon/${size}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('icons rendered');
