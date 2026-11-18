import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const url = process.argv[2] || "http://localhost:5173/";
const out = resolve(process.argv[3] || "screenshot.png");
const width = Number(process.env.SHOT_WIDTH || 1440);
const height = Number(process.env.SHOT_HEIGHT || 900);
const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome"; // system Chrome; set empty to use bundled

mkdirSync(dirname(out), { recursive: true });

const launchOpts = { headless: true };
if (channel) launchOpts.channel = channel;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`OK ${out}`);
