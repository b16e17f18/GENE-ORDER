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
    Math.random = () => 0.99;
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
    assert.equal(await ui.locator("#titleView").getByText("v0.66", { exact: true }).count(), 1);
    await shot("title");
    await ui.locator('#titleView [data-go-page="dex"]').click();
    const chaiHp = ui.locator(".dex-content .detail-stat-hp");
    assert.equal(await chaiHp.locator(".detail-stat-value").textContent(), "125");
    const grade = chaiHp.getByRole("img", { name: "種族値ランク E" });
    assert.equal(await grade.textContent(), "E");
    assert.equal(await grade.evaluate((letter) => getComputedStyle(letter).color), "rgb(154, 205, 50)");
    assert.ok(await chaiHp.evaluate((row) => {
      const track = row.querySelector(".detail-stat-track").getBoundingClientRect();
      const letter = row.querySelector(".detail-stat-grade").getBoundingClientRect();
      const value = row.querySelector(".detail-stat-value").getBoundingClientRect();
      return track.right <= letter.left && letter.right <= value.left;
    }));
    const chaiAttack = ui.locator(".dex-content .detail-stat-phy_atk");
    assert.equal(await chaiAttack.locator(".detail-stat-value").textContent(), "81");
    const attackGrade = chaiAttack.getByRole("img", { name: "種族値ランク D" });
    assert.equal(await attackGrade.evaluate((letter) => getComputedStyle(letter).color), "rgb(255, 255, 0)");
    await ui.locator('[data-go-dex="character_047"]').click();
    assert.match(await ui.locator(".dex-content").textContent(), /画像未設定.*習得技.*未設定/s);
    await ui.locator('[data-go-dex="character_019"]').click();
    assert.match(await ui.locator(".dex-content").textContent(), /異常代謝.*毒牙/s);
    const dualEntry = ui.locator('[data-go-dex="character_003"]');
    assert.ok(await dualEntry.evaluate((button) => {
      const [name, attributes] = button.children;
      const [first, second] = attributes.querySelectorAll(".go-attribute-icon");
      const nameBox = name.getBoundingClientRect();
      const firstBox = first.getBoundingClientRect();
      const secondBox = second.getBoundingClientRect();
      const css = getComputedStyle(button);
      const bounds = button.getBoundingClientRect();
      const left = bounds.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
      const right = bounds.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight);
      return css.textAlign === "left" && Math.abs(nameBox.left - left) < 1 &&
        nameBox.right <= firstBox.left && firstBox.right <= secondBox.left &&
        Math.abs(secondBox.right - right) < 1 &&
        Math.abs((nameBox.top + nameBox.bottom) - (firstBox.top + firstBox.bottom)) < 1 &&
        firstBox.top === secondBox.top;
    }), "dex name and dual attributes should align on opposite sides of one row");
    const attributeIds = ["none", "fire", "water", "wind", "earth", "light", "dark"];
    const attributePositions = [0, 12.91, 25.43, 62.78, 75.2, 87.71, 100];
    const iconData = await ui.locator(".dex-list").evaluate((list, ids) => ids.map((id) => {
      const icon = list.querySelector(".go-attribute-" + id);
      if (!icon) return null;
      const css = getComputedStyle(icon);
      return { label: icon.getAttribute("aria-label"), image: css.backgroundImage, position: css.backgroundPositionX };
    }), attributeIds);
    for (const [index, icon] of iconData.entries()) {
      assert.match(icon?.label ?? "", /^(無|火|水|風|地|光|闇)属性$/);
      assert.match(icon.image, /go-attribute-backgrounds[.]png/);
      assert.ok(Math.abs(parseFloat(icon.position) - attributePositions[index]) < 0.001);
    }
    assert.deepEqual(await page.evaluate(async () => {
      const image = new Image();
      image.src = "./asset/element/go-attribute-backgrounds.png";
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }), [2172, 724]);
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
      assert.equal(await card.locator(".detail-stat-grade").count(), 6);
      assert.equal(await card.locator(".detail-stat-regen_value .detail-stat-grade").count(), 0);
      const tracks = await card.locator(".detail-stat-track").evaluateAll((bars) => bars.map((bar) => {
        const { left, right, width } = bar.getBoundingClientRect();
        return { left, right, width };
      }));
      assert.equal(tracks.length, expected.length);
      const [first] = tracks;
      assert.ok(first.width > 0 && tracks.every(({ left, right }) =>
        Math.abs(left - first.left) < 1 && Math.abs(right - first.right) < 1), "character stat tracks are misaligned");
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
    const dodge = byId("go-dodge");
    const pass = () => dodge.click();
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
    assert.deepEqual(await ui.locator(".command-tabs .tab-button:visible").allTextContents(), ["回避", "入替", "相性"]);
    const chartButton = byId("go-battle-chart");
    const chart = ui.getByRole("dialog", { name: "属性相性一覧表" });
    await chartButton.click();
    assert.equal(await chart.locator("td[data-attack][data-defense]").count(), 81);
    assert.equal(await chart.locator('td[aria-label="0倍"]').count(), 3);
    const expectedOrder = ["火属性", "水属性", "雷属性", "氷属性", "風属性", "地属性", "光属性", "闇属性", "無属性"];
    for (const section of ["thead", "tbody th"]) {
      assert.deepEqual(await chart.locator(section + " .go-attribute-icon").evaluateAll(
        (icons) => icons.map((icon) => icon.getAttribute("aria-label"))), expectedOrder);
    }
    assert.ok(await chart.locator(".go-chart-scroll").evaluate((table) => table.scrollWidth === table.clientWidth));
    await shot("chart", true);
    const chartImage = await chart.getByRole("link", { name: /相性表を画像で見る/ }).getAttribute("href");
    assert.deepEqual(await page.evaluate(async (href) => {
      const image = new Image();
      image.src = href;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, chartImage), [1448, 1086]);
    await chart.getByRole("button", { name: "閉じる" }).click();
    assert.ok(await chart.isHidden());
    assert.ok(await chartButton.evaluate((button) => document.activeElement === button));
    await chartButton.click();
    await page.keyboard.press("Escape");
    assert.ok(await chart.isHidden());
    await chartButton.click();
    await page.mouse.click(1, 1);
    assert.ok(await chart.isHidden());
    assert.ok(await move("skill_002").isEnabled());
    assert.equal(await byId("moveGrid").locator("[data-go-wait], [data-go-move='skill_000']").count(), 0);
    assert.equal(await byId("dexButton").count(), 0);
    assert.ok(await byId("playerHud").locator(".go-hud-rank-line").isHidden());
    assert.ok(await byId("enemyHud").locator(".go-hud-rank-line").isHidden());
    const inspect = byId("enemyInfoPanel");
    const inspectEnemy = () => byId("enemySprite").locator("[data-fighter-side]").click();
    const closeInspect = () => inspect.getByRole("button", { name: "戻る" }).click();
    await inspectEnemy();
    assert.equal(await inspect.locator(".detail-title").textContent(), "相手情報");
    assert.equal(await inspect.locator(".detail-subtitle").textContent(), "ヒョウカイツムツム");
    assert.equal(await inspect.locator(".battle-inspect-row .effect-chip").textContent(), "なし");
    assert.match(await inspect.locator(".battle-inspect-body").textContent(), /回避率\s*30%/);
    assert.match(await inspect.locator(".battle-inspect-body").textContent(), /EN回復\s*1 EN \/ ターン/);
    assert.deepEqual(await inspect.locator(".detail-stat-label").allTextContents(),
      ["物理攻撃", "物理防御", "特殊攻撃", "特殊防御", "敏捷", "回復力"]);
    assert.equal(await inspect.locator(".detail-stat-phy_def .detail-stat-value").textContent(), "143");
    assert.equal(await inspect.locator(".detail-stat-phy_def .detail-stat-grade").textContent(), "A");
    assert.equal(await inspect.locator(".detail-stat-grade").count(), 5);
    assert.match(await inspect.locator(".detail-passive").textContent(), /特性.*氷棚形成/s);
    const resistances = inspect.locator(".battle-inspect-resistance-grid .resistance-cell");
    assert.equal(await resistances.count(), 9);
    for (const [id, expected] of [["thunder", "100%"], ["ice", "50%"], ["wind", "50%"]]) {
      const resistance = resistances.filter({ has: page.locator(".go-attribute-" + id) });
      assert.equal(await resistance.locator("strong").textContent(), expected);
    }
    await shot("inspect");
    await closeInspect();
    assert.ok(await dodge.isEnabled());
    await shot("battle");
    await byId("go-fast-battle").check();
    await pass(); await pass();
    assert.match(await byId("go-official-log").textContent(), /回避判定/);
    await move("skill_041").click(); await pass();
    assert.match(await byId("playerHud").textContent(), /デコイ 体力 72\/72/);
    await move("skill_042").click(); await pass();
    assert.match(await byId("switchGrid").textContent(), /パワーリレー/);
    assert.equal(await ui.locator("[data-go-switch]").count(), 2);
    assert.equal(await ui.locator("[data-go-switch]").filter({ has: page.locator(".go-attribute-icon") }).count(), 2);
    await shot("switch");
    await chooseSwitch("カブキジャベリン");
    assert.match(await byId("playerHud").textContent(), /カブキジャベリン.*デコイ 体力/s);
    assert.match(await byId("go-official-log").textContent(), /羽音/);
    await byId("switchTab").click();
    await chooseSwitch("アルカトリオ"); await pass();
    assert.match(await byId("playerHud").textContent(), /アルカトリオ/);
    assert.doesNotMatch(await byId("playerHud").textContent(), /デコイ 体力/);
    await move("skill_053").click(); await pass();
    assert.match(await byId("enemyHud").textContent(), /毒/);
    await inspectEnemy();
    assert.match(await inspect.locator(".battle-inspect-row .effect-chip").textContent(), /毒/);
    await closeInspect();
    for (let turn = 0; turn < 24 && !await ui.locator("[data-go-replay]").isVisible(); turn++) {
      if (await byId("switchGrid").isVisible()) {
        assert.match(await byId("switchGrid").textContent(), /戦闘不能後の補充/);
        assert.match(await byId("enemyHud").textContent(), /0\/146.*戦闘不能/s);
        await chooseSwitch("バグズニードル");
      } else {
        if (await move("skill_053").isEnabled()) await move("skill_053").click();
        else await pass();
        await pass();
      }
    }
    assert.match(await byId("enemyInfoPanel").textContent(), /勝利/);
    assert.match(await byId("go-official-log").textContent(), /戦闘不能.*バグズニードルが登場/s);
    await shot("result");
    await ui.locator("[data-go-replay]").click();
    assert.match(await byId("playerHud").textContent(), /ユーズドマウス.*217\/217/s);
    assert.doesNotMatch(await byId("go-official-log").textContent(), /勝利/);
    await byId("go-fast-battle").check();
    await move("skill_043").click(); await pass();
    assert.deepEqual(await byId("playerHud").locator(".go-hud-ranks > span").allTextContents(), ["物理攻撃+1"]);
    await move("skill_002").click(); await pass();
    assert.deepEqual(await byId("enemyHud").locator(".go-hud-ranks > span").allTextContents(), ["物理防御-1"]);
    await inspectEnemy();
    assert.match(await inspect.locator(".detail-stat-phy_def .detail-stat-value").textContent(), / \(-1\)$/);
    assert.equal(await inspect.locator(".detail-stat-phy_def .detail-stat-grade").textContent(), "A");
    await closeInspect();
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("go-official-mode").selectOption("enemy");
    await byId("startButton").click();
    await byId("go-fast-battle").uncheck();
    await dodge.dblclick();
    await page.waitForFunction(() => !document.querySelector("#go-app #go-dodge")?.disabled);
    const log = byId("go-official-log");
    assert.equal((await log.textContent()).match(/ユーズドマウスの回避（EN/g)?.length, 1);
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
    await pick("012");
    await byId("go-official-mode").selectOption("manual");
    await byId("startButton").click();
    await byId("go-fast-battle").check();
    assert.ok(await move("skill_020").isEnabled());
    await move("skill_020").click(); await pass();
    await byId("playerSprite").locator("[data-fighter-side]").click();
    const playerInfo = byId("enemyInfoPanel");
    assert.match(await playerInfo.locator(".battle-inspect-body").textContent(), /次の雷属性攻撃の威力 ×1.5/);
    assert.match(await log.textContent(), /次の雷属性攻撃の威力が1.5倍/);
    await playerInfo.getByRole("button", { name: "戻る" }).click();
    await move("skill_035").click(); await pass();
    assert.match(await log.textContent(), /サウンドウォールに雷属性の威力強化.*消費した（威力135）/);
    await byId("playerSprite").locator("[data-fighter-side]").click();
    assert.doesNotMatch(await playerInfo.locator(".battle-inspect-body").textContent(), /次の雷属性攻撃の威力/);
    await playerInfo.getByRole("button", { name: "戻る" }).click();
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("setupPlayerModeButton").click();
    await byId("clearTeamButton").click();
    await pick("020");
    await byId("go-official-mode").selectOption("manual");
    await byId("startButton").click();
    await pass(); await pass();
    await move("skill_054").click(); await pass();
    await byId("go-fast-battle").uncheck();
    await move("skill_054").click(); await pass();
    const sheet = byId("battleAnimationLayer").locator(".go-sheet");
    const waitForSheet = async (file) => {
      await page.waitForFunction((expected) => {
        const marker = document.querySelector("#go-app #battleAnimationLayer .go-sheet");
        return marker?.style.backgroundImage.includes(expected);
      }, file);
    };
    await waitForSheet("attack_hit01.png");
    assert.match(await sheet.evaluate(el => el.style.backgroundImage), /attack_hit01\.png/);
    assert.equal(bgmRequested, true);
    await ui.locator('.go-battle-footer [data-go-page="setup"]').click();
    await byId("startButton").click();
    await move("skill_038").click(); await pass();
    await waitForSheet("magic_fire01.png");
    assert.match(await sheet.evaluate(el => el.style.backgroundImage), /magic_fire01\.png/);
    const playback = await sheet.evaluate(el => el.getAnimations()[0].effect.getTiming());
    assert.equal(playback.duration, 250);
    assert.equal(playback.iterations, 2);
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
    assert.equal(new Set(masters).size, 10);
    assert.ok(images.every((path) => ["/asset/character/character_047.png", "/asset/character/character_064.png"].includes(path)));
    console.log(`Edge ${width}px: official flow, all modes, replay, double-click, 10 CSVs. Image probes: ${images.join(", ")}`);
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
