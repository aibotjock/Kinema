// Screenshot our persona-studio states for blind panels (ours vs the bar).
// Run: node scripts/shoot-ours.mjs   (server must be up on :4317)
import { chromium } from '/home/aiprobldr/projects/gauntlet-loop/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../evidence/ours/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const FF = execFileSync('bash', ['-c', 'ls ~/.local/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-* | head -1']).toString().trim();

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const browser = await chromium.launch();
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const shoot = async (name, { clipTop = null } = {}) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    const png = `${OUT}${name}-${vp}.png`;
    if (clipTop) await page.screenshot({ path: png, clip: { x: 0, y: 0, width: viewport.width, height: Math.min(2000, viewport.height * 2) } });
    else await page.screenshot({ path: png, fullPage: false });
    const jpg = `${OUT}${name}-${vp}.jpg`;
    execFileSync(FF, ['-y', '-i', png, '-vf', 'scale=640:-2', '-q:v', '6', jpg]);
    console.log('shot', name, vp);
  };
  await page.goto('http://127.0.0.1:4317/', { waitUntil: 'networkidle' });
  await shoot('home');

  // Persona library (cards)
  await page.locator('#persona-studio').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shoot('studio-library');

  // Persona creation form + consent capture
  await page.click('#new-persona');
  await page.waitForTimeout(500);
  await shoot('persona-form');

  // Compose (persona selected; click the card header so we don't hit Hear/delete)
  const card = page.locator('#persona-cards .persona-card .mc-head').first();
  await card.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('#persona-compose').scrollIntoViewIfNeeded().catch(() => {});
  await shoot('compose');

  // Library / history of films
  await page.locator('#library').scrollIntoViewIfNeeded().catch(() => {});
  const libVisible = await page.locator('#library').isVisible().catch(() => false);
  if (!libVisible) {
    // library is hidden until history loads — trigger via nav if present
    await page.locator('a[href="#library"], button:has-text("Library"), nav a:has-text("films")').first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await shoot('library');

  await page.close();
}
await browser.close();
console.log('done');
