// Usage: node tools/check-ui.cjs. Set GO_PLAYWRIGHT_PATH if Playwright is in a separate runtime.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || "playwright");
const { createServer } = require("node:http");
const { mkdir, readFile } = require("node:fs/promises");
const { extname, resolve, sep } = require("node:path");
const assert = require("node:assert/strict");

const root = resolve(__dirname, "..");
const artifacts = resolve(root, ".cache", "v0.60-edge");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg" };
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = resolve(root, "." + (name === "/" ? "/index.html" : name));
    if (!file.startsWith(root + sep)) throw new Error("Outside repository");
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

async function verify(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });
  const errors = [];
  const images = [];
  const masters = [];
  const legacyRequests = [];
  let bgmRequested = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.request().resourceType() === "image") images.push(new URL(response.url()).pathname);
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith(".csv")) masters.push(path);
    if (path === "/asset/bgm/free-battle.mp3") bgmRequested = true;
    if (path.startsWith("/assets/") || path.endsWith("/data-inline.js")) legacyRequests.push(path);
  });
  await page.addInitScript(() => {
    Math.random = () => 0.1;
    window.__storageReads = [];
    for (const name of ["getItem", "setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (...args) {
        window.__storageReads.push([name, ...args]);
        return original.apply(this, args);
      };
    }
    document.addEventListener("DOMContentLoaded", () => {
      for (const name of ["initializeLegacyScreens", "startBattle", "resolveTurn", "renderBattle"]) {
        window[name] = () => { throw new Error("Legacy routine used: " + name); };
      }
    }, { once: true });
  });
  try {
    await page.goto("http://127.0.0.1:" + server.address().port);
    const ui = page.locator("#go-app");
    const byId = (id) => ui.locator("#" + id);
    const shot = async (name, overlay = false) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, name + " overflows");
      await page.screenshot({ path: resolve(artifacts, width + "-" + name + ".png"), fullPage: !overlay });
    };
    await ui.getByRole("heading", { name: "GENE ORDER" }).waitFor();
    assert.equal(await page.locator(".go-preview").isHidden(), true);
    assert.equal(await ui.locator("#titleView").getByText("v0.63", { exact: true }).count(), 1);
    await shot("title");
    await ui.locator('#titleView [data-go-page="dex"]').click();
    await ui.locator('[data-go-dex="character_047"]').click();
    assert.match(await ui.locator(".dex-content").textContent(), /画像未設定.*習得技.*未設定/s);
    await ui.locator('[data-go-dex="character_019"]').click();
    assert.match(await ui.locator(".dex-content").textContent(), /異常代謝.*毒牙/s);
    const dualEntry = ui.locator('[data-go-dex="character_003"]');
    assert.ok(await dualEntry.evaluate((button) => {
      const [name, attributes] = button.children;
      const [first, second] = attributes.querySelectorAll(".go-attribute-icon");
      return name.getBoundingClientRect().right <= first.getBoundingClientRect().left &&
        first.getBoundingClientRect().right <= second.getBoundingClientRect().left &&
        first.getBoundingClientRect().top === second.getBoundingClientRect().top;
    }), "dex dual attributes overlap the name or wrap");
    const attributeIds = ["none", "fire", "water", "wind", "earth", "light", "dark"];
    const iconData = await ui.locator(".dex-list").evaluate((list, ids) => ids.map((id) => {
      const icon = list.querySelector(".go-attribute-" + id);
      if (!icon) return null;
      const css = getComputedStyle(icon);
      return { label: icon.getAttribute("aria-label"), image: css.backgroundImage, position: css.backgroundPositionX };
    }), attributeIds);
    for (const [index, icon] of iconData.entries()) {
      assert.match(icon?.label ?? "", /^(無|火|水|風|地|光|闇)属性$/);
      assert.match(icon.image, /go-attributes[.]webp/);
      assert.ok(Math.abs(parseFloat(icon.position) - index * 100 / 6) < 0.001);
    }
    assert.deepEqual(await page.evaluate(async () => {
      const image = new Image();
      image.src = "./asset/element/go-attributes.webp";
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }), [392, 56]);
    const verifyCard = async (card) => {
      const stats = await card.locator(".detail-stat").evaluateAll((rows) => rows.map((row) => [
        row.querySelector(".detail-stat-label").textContent,
        parseInt(row.querySelector("strong").textContent, 10),
        parseInt(row.style.getPropertyValue("--bar-width"), 10),
        getComputedStyle(row.querySelector(".detail-stat-fill")).backgroundColor,
      ]));
      const expected = [
        ["体力", 275, "rgb(157, 240, 0)"], ["物理攻撃", 225, "rgb(229, 57, 53)"],
        ["物理防御", 225, "rgb(246, 215, 67)"], ["特殊攻撃", 225, "rgb(255, 90, 165)"],
        ["特殊防御", 225, "rgb(255, 157, 40)"], ["敏捷", 225, "rgb(0, 158, 232)"],
        ["回復力", 50, "rgb(59, 209, 127)"],
      ];
      assert.equal(stats.length, expected.length);
      for (const [index, [label, value, bar, color]] of stats.entries()) {
        const [name, max, rgb] = expected[index];
        assert.equal(label, name);
        assert.ok(Number.isFinite(value));
        assert.equal(bar, Math.round(Math.min(value / max, 1) * 100), name);
        assert.equal(color, rgb, name);
      }
      assert.ok(await card.locator(".detail-skill-card .go-attribute-icon").count());
    };
    await verifyCard(ui.locator(".dex-content"));
    await shot("dex", true);
    await ui.locator(".dex-close").click();
    await byId("battleModeButton").click();
    assert.ok(await byId("startButton").isDisabled());
    assert.ok(await ui.locator('[data-go-pick="character_047"]').isDisabled());
    const pick = (id) => ui.locator('[data-go-pick="character_' + id + '"]').click();
    await pick("016"); await pick("015"); await pick("019");
    await ui.locator('[data-go-lead="character_015"]').click();
    await byId("setupEnemyModeButton").click();
    await pick("009"); await pick("005");
    await byId("go-official-mode").selectOption("manual");
    assert.ok(await ui.locator('[data-go-pick="character_019"] .go-attribute-icon').count());
    await ui.locator('[data-go-detail="character_019"]').click();
    assert.ok(await byId("detailPanel").locator(".detail-subtitle .go-attribute-icon").count());
    await verifyCard(byId("detailPanel"));
    await shot("detail", true);
    await byId("detailPanel").locator(".detail-close").click();
    await shot("team");
    await byId("startButton").click();
    const wait = () => ui.locator("[data-go-wait]").click();
    const move = (id) => ui.locator('[data-go-move="' + id + '"]');
    const chooseSwitch = (name) => ui.locator("[data-go-switch]").filter({ hasText: name }).click();
    assert.match(await byId("playerHud").textContent(), /ユーズドマウス.*217\/217/s);
    assert.ok(await move("skill_041").isDisabled());
    assert.match(await move("skill_041").textContent(), /ENが不足/);
    const board = await ui.locator(".battle-field").boundingBox();
    for (const id of ["playerSprite", "enemySprite"]) {
      const portrait = byId(id).locator("img");
      assert.ok(await portrait.evaluate((image) => image.complete && image.naturalHeight > 0));
      const box = await portrait.boundingBox();
      assert.ok(box.y >= board.y && box.y + box.height <= board.y + board.height, id + " image is clipped");
    }
    assert.ok(await byId("playerHud").locator(".go-attribute-icon").count());
    assert.ok(await byId("playerSprite").locator(".go-attribute-icon").count());
    assert.equal(await byId("playerHud").locator(".hp-line > span").first().textContent(), "体力");
    assert.ok(await move("skill_000").locator(".go-attribute-none").count());
    const ranks = byId("playerHud").locator(".go-hud-ranks > span");
    assert.deepEqual(await ranks.allTextContents(), ["物理攻撃+0", "物理防御+0", "特殊攻撃+0", "特殊防御+0", "敏捷+0"]);
    assert.ok(await ranks.evaluateAll((items) => items.every((rank) => {
      const range = document.createRange();
      range.selectNodeContents(rank);
      return range.getClientRects().length === 1;
    })), "battle stat label wraps");
    await shot("battle");
    await byId("go-fast-battle").check();
    await move("skill_000").click(); await wait();
    assert.match(await byId("go-official-log").textContent(), /回避判定/);
    await move("skill_041").click(); await wait();
    assert.match(await byId("playerHud").textContent(), /デコイ 体力 72\/72/);
    await move("skill_042").click(); await wait();
    assert.match(await byId("switchGrid").textContent(), /パワーリレー/);
    assert.equal(await ui.locator("[data-go-switch]").count(), 2);
    assert.equal(await ui.locator("[data-go-switch]").filter({ has: page.locator(".go-attribute-icon") }).count(), 2);
    await shot("switch");
    await chooseSwitch("カブキジャベリン");
    assert.match(await byId("playerHud").textContent(), /カブキジャベリン.*デコイ 体力/s);
    assert.match(await byId("go-official-log").textContent(), /羽音/);
    await byId("switchTab").click();
    await chooseSwitch("アルカトリオ"); await wait();
    assert.match(await byId("playerHud").textContent(), /アルカトリオ/);
    assert.doesNotMatch(await byId("playerHud").textContent(), /デコイ 体力/);
    await move("skill_053").click(); await wait();
    assert.match(await byId("enemyHud").textContent(), /毒/);
    for (let turn = 0; turn < 24 && !await ui.locator("[data-go-replay]").isVisible(); turn++) {
      if (await byId("switchGrid").isVisible()) {
        assert.match(await byId("switchGrid").textContent(), /戦闘不能後の補充/);
        assert.match(await byId("enemyHud").textContent(), /0\/146.*戦闘不能/s);
        await chooseSwitch("バグズニードル");
      } else {
        if (await move("skill_053").isEnabled()) await move("skill_053").click();
        else await wait();
        const unfinished = move("skill_020");
        if (await unfinished.count()) {
          assert.ok(await unfinished.isDisabled());
          assert.match(await unfinished.textContent(), /未対応/);
        }
        await wait();
      }
    }
    assert.match(await byId("enemyInfoPanel").textContent(), /勝利/);
    assert.match(await byId("go-official-log").textContent(), /戦闘不能.*バグズニードルが登場/s);
    await shot("result");
    await ui.locator("[data-go-replay]").click();
    assert.match(await byId("playerHud").textContent(), /ユーズドマウス.*217\/217/s);
    assert.doesNotMatch(await byId("go-official-log").textContent(), /勝利/);
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("go-official-mode").selectOption("enemy");
    await byId("startButton").click();
    await byId("go-fast-battle").uncheck();
    await ui.locator("[data-go-wait]").dblclick();
    await page.waitForFunction(() => !document.querySelector("#go-app [data-go-wait]")?.disabled);
    const log = byId("go-official-log");
    assert.equal((await log.textContent()).match(/ユーズドマウスは待機/g)?.length, 1);
    assert.equal(await ui.locator("#go-ai-diagnostics").count(), 0);
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("go-official-mode").selectOption("auto");
    await byId("startButton").click();
    await byId("go-fast-battle").check();
    await ui.locator("[data-go-turn]").click();
    assert.ok((await log.locator("li").count()) > 0);
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("setupPlayerModeButton").click();
    await byId("clearTeamButton").click();
    await pick("020");
    await byId("go-official-mode").selectOption("manual");
    await byId("startButton").click();
    await wait(); await wait();
    await move("skill_054").click(); await wait();
    await byId("go-fast-battle").uncheck();
    await move("skill_054").click(); await wait();
    await byId("battleAnimationLayer").locator(".go-sheet").waitFor();
    assert.equal(bgmRequested, true);
    await ui.locator('.go-battle-footer [data-go-page="title"]').click();
    await ui.getByRole("heading", { name: "GENE ORDER" }).waitFor();
    await page.waitForFunction(() => document.querySelector("#go-app #battleAnimationLayer").childElementCount === 0);
    assert.equal(await page.evaluate(() => bgmRuntime.currentBgmId), "");
    await ui.locator('#titleView [data-go-page="debug"]').click();
    assert.equal(await page.locator(".go-preview").isVisible(), true);
    assert.ok(await page.locator(".go-preview .go-attribute-icon").count());
    assert.deepEqual(await page.evaluate(() => window.__storageReads), []);
    assert.deepEqual(legacyRequests, []);
    assert.deepEqual(errors, []);
    assert.equal(new Set(masters).size, 9);
    assert.ok(images.every((path) => ["/asset/character_047.png", "/asset/character_064.png"].includes(path)));
    console.log(`Edge ${width}px: official flow, all modes, replay, double-click, 9 CSVs. Image probes: ${images.join(", ")}`);
  } finally {
    await page.close();
  }
}

(async () => {
  await mkdir(artifacts, { recursive: true });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const width of [1280, 390]) await verify(browser, width);
    console.log(artifacts);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
