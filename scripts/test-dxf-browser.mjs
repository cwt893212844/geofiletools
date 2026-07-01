/**
 * Quick DXF→SHP browser test via Playwright. Usage:
 *   node scripts/test-dxf-browser.mjs [path-to.dxf]
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const dxfPath = resolve(process.argv[2] ?? '北山村JMD-201612.dxf');
const url = 'http://localhost:4321/convert/dxf-to-shp';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') {
    console.log(`[console.${type}]`, msg.text());
  }
});

page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
console.log('Page loaded, uploading', dxfPath);

const input = page.locator('input[type="file"]');
await input.setInputFiles(dxfPath);

const deadline = Date.now() + 600_000;
let lastText = '';

while (Date.now() < deadline) {
  const text = await page.locator('body').innerText();
  if (text !== lastText) {
    const snippet = text
      .split('\n')
      .filter((line) => /convert|error|fail|complete|engine|%/i.test(line))
      .slice(0, 12)
      .join(' | ');
    if (snippet) console.log(snippet);
    lastText = text;
  }

  if (text.includes('Conversion complete') || text.includes('Download result')) {
    console.log('SUCCESS');
    break;
  }
  if (text.includes('Conversion failed')) {
    const errLine = text.split('\n').find((l) => l.includes('GDAL') || l.includes('could not') || l.includes('failed'));
    console.log('FAILED:', errLine ?? 'no detail');
    break;
  }

  await page.waitForTimeout(3000);
}

await browser.close();
