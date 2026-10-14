// Rasterize brand SVGs to PNG with Playwright's bundled headless Chromium.
// Renders each SVG in its own browser tab at exactly its viewBox size, with no
// device scaling, and screenshots the viewport. Run: node brand/rasterize.js
const path = require('path');
const pw = require('playwright-core');

const jobs = [
  { svg: 'icon.svg', png: 'icon.png', w: 1024, h: 1024 },
  { svg: 'featured-light.svg', png: 'featured-light.png', w: 1600, h: 900 },
  { svg: 'featured-dark.svg', png: 'featured-dark.png', w: 1600, h: 900 },
];

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  for (const j of jobs) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: j.w, height: j.h });
    const url = 'file://' + path.join(__dirname, j.svg);
    await page.goto(url);
    await page.screenshot({ path: path.join(__dirname, j.png) });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
