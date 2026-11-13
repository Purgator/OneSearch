// Regenerates the README screenshots in docs/.
// Usage: node scripts/screenshots.js
//
// Loads the real, unpacked extension (this repo folder) in headless Chrome and
// drives it with Puppeteer on a made-up article (scripts/demo/article.html)
// served from a throwaway local server. Nothing is mocked: the find bar, the
// highlights, the popup and the options page are the extension's own.
//
// Puppeteer is not a dependency of this repo. The script picks it up from, in
// order: $PUPPETEER_DIR (a folder containing node_modules/puppeteer), this
// repo, then the sibling ../CrmLevel67 checkout. Anywhere else:
//   npm install --no-save puppeteer
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createRequire } = require("module");

const root = path.join(__dirname, "..");
const docs = path.join(root, "docs");
const PORT = Number(process.env.PORT) || 6811;
const VIEWPORT = { width: 1360, height: 780, deviceScaleFactor: 1.5 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPuppeteer() {
  const bases = [process.env.PUPPETEER_DIR, root, path.join(root, "..", "CrmLevel67")];
  for (const base of bases.filter(Boolean)) {
    try {
      return createRequire(path.join(base, "noop.js"))("puppeteer");
    } catch { /* try the next location */ }
  }
  throw new Error("Puppeteer not found. Run: npm install --no-save puppeteer");
}

function serveDemoPage() {
  const html = fs.readFileSync(path.join(__dirname, "demo", "article.html"));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const puppeteer = loadPuppeteer();
  fs.mkdirSync(docs, { recursive: true });
  const server = await serveDemoPage();
  const browser = await puppeteer.launch({ enableExtensions: [root] });
  try {
    const worker = await browser.waitForTarget((t) => t.type() === "service_worker");
    const extensionUrl = (file) => `chrome-extension://${new URL(worker.url()).host}/${file}`;
    const shot = (page, name, options = {}) =>
      page.screenshot({ path: path.join(docs, name), ...options });

    const openArticle = async () => {
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.goto(`http://localhost:${PORT}/`);
      await page.bringToFront();
      await wait(300); // let the content script load its settings
      return page;
    };

    // 1. Hero: Ctrl+F, rainbow highlights, live counter, scrollbar minimap.
    //    "cafe" also matches "café" (diacritics-insensitive by default).
    let page = await openArticle();
    await page.keyboard.down("Control");
    await page.keyboard.press("f");
    await page.keyboard.up("Control");
    await page.keyboard.type("cafe", { delay: 40 });
    await wait(500);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Enter");
      await wait(150);
    }
    await wait(1500); // spotlight rings and smooth scroll settle
    await shot(page, "find-bar.png");

    // 2. Spotlight rings converging on the match, caught mid-flight. The
    //    animation is too quick to catch at its default speed, so it is slowed
    //    down with the extension's own settings, which are reset afterwards.
    const settingsPage = await browser.newPage();
    await settingsPage.goto(extensionUrl("src/options.html"));
    await settingsPage.evaluate(() =>
      chrome.storage.sync.set({ spotlightDuration: 1600, spotlightStagger: 300 }));
    await page.bringToFront();
    // The soft ring glows compress badly: 1x keeps this PNG small.
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
    await wait(300);
    await page.keyboard.press("Enter");
    await wait(300);
    await shot(page, "spotlight.png", { clip: { x: 0, y: 0, width: 1360, height: 700 } });
    await settingsPage.evaluate(() => chrome.storage.sync.clear());
    await settingsPage.close();
    await page.close();

    // 3. Quick find in links only ('): only link text matches.
    page = await openArticle();
    await page.keyboard.press("'");
    await page.keyboard.type("cafe", { delay: 40 });
    await wait(1500);
    await shot(page, "quick-find-links.png");
    await page.close();

    // 4. Options page, top of the page (colors and search defaults).
    page = await browser.newPage();
    await page.setViewport({ width: 900, height: 760, deviceScaleFactor: 1.5 });
    await page.goto(extensionUrl("src/options.html"));
    await wait(500);
    await shot(page, "options.png");
    await page.close();

    // 5. Toolbar popup, at its natural size.
    page = await browser.newPage();
    await page.setViewport({ width: 300, height: 400, deviceScaleFactor: 2 });
    await page.goto(extensionUrl("src/popup.html"));
    await wait(300);
    await (await page.$("body")).screenshot({ path: path.join(docs, "popup.png") });
    await page.close();

    console.log("screenshots written to docs/");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
