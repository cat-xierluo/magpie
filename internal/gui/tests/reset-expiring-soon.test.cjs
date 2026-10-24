// Run with Node's test runner and Playwright on the module path; see README.md.
// A GLM Coding plan's resets, counted by window, say on the card's line how
// many of them run out within two hours: a card whose soonest end is a
// long way off says nothing, and one whose ends weren't read counts none
// rather than reading its soonest end as one. The Usage page's card and the
// menu bar panel's, at 900px and 440px. English, Chinese, Japanese and
// German, Chromium and WebKit; no backend, the API is faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");
const base = Date.now();
const soon = new Date(base + 40 * 60e3).toISOString();     // inside two hours
const day = 864e5;
const later = new Date(base + 60 * day).toISOString();       // far off
const quotas = [
  { provider: "zhipu", name: "GLM Coding", icon: "zhipu-color", user: "me@example.com", plan: "Pro",
    windows: [{ name: "5 hours", used: 30 }],
    resets: { count: 4, byWindow: true, fiveHour: 3, weekly: 1, until: soon,
      each: [{ until: soon, window: "fiveHour" }, { until: later, window: "fiveHour" }, { until: later, window: "weekly" }] } },
  { provider: "zhipu", name: "GLM Coding", icon: "zhipu-color", user: "far@example.com", plan: "Pro",
    windows: [{ name: "5 hours", used: 30 }],
    resets: { count: 2, byWindow: true, fiveHour: 2, weekly: 0, until: later,
      each: [{ until: later, window: "fiveHour" }, { until: later, window: "fiveHour" }] } },
  { provider: "zhipu", name: "GLM Coding", icon: "zhipu-color", user: "silent@example.com", plan: "Pro",
    windows: [{ name: "5 hours", used: 30 }],
    resets: { count: 1, byWindow: true, fiveHour: 1, weekly: 0, until: soon } },
];

function serve(lang) {
  const settings = { theme: "light", lang, tray: "panel", quotaLeft: false, currency: "usd", trayUsages: ["zhipu"], trayUsageEvery: 3 };
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:false};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings });
    if (url.pathname === "/api/settings") return json(settings);
    if (url.pathname === "/api/usage/quotas") return json(quotas);
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await route.fulfill({ body: await fs.readFile(file), contentType });
  };
}

const words = {
  en: (n) => `${n} of them run out within two hours`,
  zh: (n) => `其中 ${n} 张 2 小时内到期`,
  "zh-TW": (n) => `其中 ${n} 張 2 小時內到期`,
  ja: (n) => `うち${n}枚は2時間以内に期限切れ`,
  de: (n) => `${n} davon laufen innerhalb von zwei Stunden ab`,
};

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of Object.keys(words)) {
    test(`${engine} ${lang}: a plan's resets say how many run out within two hours`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      t.after(() => browser.close());
      const errors = [];
      const open = async (url, viewport) => {
        const page = await (await browser.newContext({ viewport, reducedMotion: "reduce" })).newPage();
        page.setDefaultTimeout(5000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", serve(lang));
        await page.goto(url);
        return page;
      };
      const want = words[lang];
      const check = async (page, sel) => {
        await page.locator(sel).first().waitFor();
        const soonLines = await page.locator(sel + " .resets-soon").allTextContents();
        // the account with a reset inside two hours says so; the one whose
        // ends are far off says nothing; the one whose ends weren't read
        // says nothing either
        assert.deepEqual(soonLines.map((s) => s.trim()), [("· " + want(1)).trim()], "only the account with a reset inside two hours says so");
        // the count is of the resets that run out, not of the card's
        const counted = await page.evaluate((day) => resetsExpiringSoon({ byWindow: true, each: [
          { until: new Date(Date.now() + 30 * 60e3).toISOString(), window: "fiveHour" },
          { until: new Date(Date.now() + 90 * 60e3).toISOString(), window: "fiveHour" },
          { until: new Date(Date.now() + 30 * day).toISOString(), window: "weekly" },
        ] }), day);
        assert.equal(counted, 2, "both resets inside two hours are counted");
      };

      let page;
      for (const width of [900, 440]) {
        page = await open("http://magpie.test/?view=usage", { width, height: 800 });
        await check(page, ".quota-resets");
      }
      const panel = await open("http://magpie.test/?mode=panel", { width: 440, height: 600 });
      await panel.locator('#ptabs [data-ptab="usage"]').click();
      await check(panel, ".pq-resets");

      const missing = await page.evaluate((strings) => ["zh", "zh-TW", "ja", "de"].flatMap((l) => strings.filter((k) => !I18N[l][k]).map((k) => l + ": " + k)), ["{n} of them run out within two hours"]);
      assert.deepEqual(missing, [], "the new string has its translations");
      assert.deepEqual(errors, []);
    });
  }
}
