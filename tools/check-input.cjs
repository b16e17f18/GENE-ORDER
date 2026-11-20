// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'input-validation');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) throw Error('outside root');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});

async function verify(browser, device, mode, probe = false) {
  const touch = device === 'touch';
  const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => .99;
    window.__inputTrace = [];
    window.__turnCalls = [];
    document.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (!control) return;
      const d = control.dataset;
      const command = d.goOpenMove ? 'open:' + d.goOpenMove : d.goMove ? 'use:' + d.goMove : d.goSwitch !== undefined ? 'switch:' + d.goSwitch : control.id;
      window.__inputTrace.push({ command, detail: event.detail, pointer: event.pointerType || '', trusted: event.isTrusted });
    }, true);
    document.addEventListener('DOMContentLoaded', () => {
      const create = geneOrderBattle.createBattle;
      geneOrderBattle.createBattle = options => {
        const battle = create(options);
        if (window.__statusFixture) {
          const definition = state.effects.get(window.__statusFixture);
          geneOrderBattle.activeFighter(battle, 'player').statuses.push({ definition, turns: definition.turn });
        }
        return battle;
      };
      const original = geneOrderBattle.resolveTurn;
      geneOrderBattle.resolveTurn = (battle, actions) => {
        const call = { turn: battle.turn, actions: JSON.parse(JSON.stringify(actions)) };
        window.__turnCalls.push(call);
        const result = original(battle, actions);
        call.events = result.events.map(({ type, side, stat, delta, effect, moveId, reason, name, damage }) => ({ type, side, stat, delta, effect, moveId, reason, name, damage }));
        call.playerStages = { ...geneOrderBattle.activeFighter(battle, "player").stages };
        return result;
      };
    });
  });
  const ui = page.locator('#go-app');
  const id = key => ui.locator('#' + key);
  const press = locator => touch ? locator.tap() : locator.click();
  const open = key => ui.locator('[data-go-open-move="' + key + '"]');
  const use = key => ui.locator('[data-go-move="' + key + '"]');
  async function highCountClick(locator) {
    await locator.scrollIntoViewIfNeeded();
    const r = await locator.boundingBox();
    await page.mouse.move(r.x + 18, r.y + 18);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
  }
  const results = [];
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await id('battleModeButton').waitFor();
    await press(id('battleModeButton'));
    await id('go-official-mode').selectOption(mode);
    for (const n of ['015', '016', '019']) await press(ui.locator('[data-go-pick="character_' + n + '"]'));
    if (mode !== 'random-enemy') {
      await press(id('setupEnemyModeButton'));
      await press(ui.locator('[data-go-pick="character_009"]'));
    }
    async function start() {
      if (await id('startButton').isHidden()) await press(ui.locator('.go-battle-footer [data-go-page="setup"]'));
      await press(id('startButton'));
      await id('go-fast-battle').check();
      await id('go-battle-bgm').uncheck();
      await page.evaluate(() => { window.__turnCalls.length = 0; window.__inputTrace.length = 0; });
    }
    async function finish(type, moveId) {
      if (mode === 'manual') {
        assert.match(await id('moveGrid').textContent(), /相手の行動/);
        await press(open('skill_031'));
        await press(use('skill_031'));
      }
      await page.waitForFunction(() => window.__turnCalls.length > 0);
      const calls = await page.evaluate(() => window.__turnCalls);
      assert.equal(calls.length, 1, 'one input must resolve only one turn');
      assert.equal(calls[0].actions.player.type, type);
      if (moveId) {
        assert.equal(calls[0].actions.player.moveId, moveId);
        assert.equal(calls[0].events.filter(e => e.type === 'move' && e.side === 'player' && e.moveId === moveId).length, 1, 'the selected move must actually execute exactly once');
        if (moveId === 'skill_000') assert.equal(calls[0].events.filter(e => e.type === 'dodge-attempt' && e.side === 'player').length, 1);
      } else assert.equal(calls[0].events.filter(e => e.type === 'switch' && e.side === 'player').length, 1);
      assert.ok(calls[0].actions.enemy, 'AI/manual opponent action is present');
      await page.waitForFunction(() => {
        const root = document.querySelector('#go-app');
        return !root.querySelector('#go-dodge').disabled || !root.querySelector('#switchGrid').classList.contains('is-hidden') || Boolean(root.querySelector('[data-go-replay]'));
      });
      assert.ok((await id('go-official-log').locator('li').count()) > 0);
      assert.doesNotMatch(await id('go-official-log').textContent(), /回避判定|回避状態が終了|半減防御が終了|被ダメージ半減が終了|を回避した/);
      return calls[0];
    }
    await start();
    if (process.env.GO_TEST_STATUSES === '1') {
      for (const status of ['poison', 'burn', 'paralysis', 'frostbite']) {
        await page.evaluate(id => { window.__statusFixture = id; Math.random = () => id === 'paralysis' ? 0 : .99; }, status);
        await start();
        const definition = await page.evaluate(id => state.effects.get(id), status);
        assert.ok((await id('playerHud').textContent()).includes(definition.name + '（5）'));
        await press(id('playerSprite').locator('[data-fighter-side]'));
        if (definition.stat_modifier_target !== 'none') {
          const expected = await page.evaluate(({ stat, mult }) => Math.floor(state.characterMap.get('character_015')[stat] * mult),
            { stat: definition.stat_modifier_target, mult: definition.stat_modifier_multiplier });
          assert.equal(await id('enemyInfoPanel').locator('.detail-stat-' + definition.stat_modifier_target + ' .detail-stat-value').textContent(), String(expected));
        }
        await press(ui.locator('[data-go-inspect-back]'));
        await press(open('skill_002')); await press(use('skill_002'));
        await press(open('skill_031')); await press(use('skill_031'));
        await page.waitForFunction(() => window.__turnCalls.length === 1 && !document.querySelector('#go-app #go-dodge').disabled);
        const call = await page.evaluate(() => window.__turnCalls[0]);
        const text = await id('go-official-log').textContent();
        if (status === 'paralysis') {
          assert.ok(call.events.some(e => e.type === 'action-failed' && e.side === 'player'));
          assert.equal(call.events.some(e => e.type === 'move' && e.side === 'player'), false);
          assert.match(text, /麻痺.*EN消費なし/);
          assert.equal(call.events.some(e => e.type === 'residual' && e.side === 'player'), false);
        } else {
          const residual = call.events.find(e => e.type === 'residual' && e.side === 'player');
          assert.equal(residual.name, definition.name);
          assert.equal(residual.damage, status === 'poison' ? 22 : 11);
        }
        assert.ok((await id('playerHud').textContent()).includes(definition.name + '（4）'));
        results.push({ status, displayed: true, call });
      }
      assert.deepEqual(errors, []);
      await writeFile(resolve(artifacts, device + '-statuses.json'), JSON.stringify(results, null, 2));
      console.log(device + ': four status HUD/detail/log checks passed.');
      return;
    }
    const button = open('skill_002');
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!touch) await page.mouse.dblclick(box.x + 18, box.y + 18, { delay: 60 });
    else { await press(button); await press(use('skill_002')); }
    const trace = await page.evaluate(() => window.__inputTrace.filter(e => /^(open|use):/.test(e.command)));
    assert.equal(trace[0].command, 'open:skill_002');
    assert.equal(trace[1].command, 'use:skill_002');
    assert.ok(trace.every(e => e.trusted), 'real browser mouse/touch events');
    if (!touch) assert.deepEqual(trace.slice(0, 2).map(e => e.detail), [1, 2]);
    if (probe) {
      assert.ok(await use('skill_002').isVisible());
      assert.match(await id('moveGrid').textContent(), /自分の技を確認/);
      assert.equal(await page.evaluate(() => window.__turnCalls.length), 0);
      await writeFile(resolve(artifacts, 'before.json'), JSON.stringify({ device, mode, trace, rejected: true }, null, 2));
      console.log('BEFORE: trusted mouse clicks [open detail=1, use detail=2] leave the move unconfirmed.');
      return;
    }
    results.push({ action: 'attack', trace, call: await finish('move', 'skill_002') });
    await start();
    await press(open('skill_043'));
    if (touch) await press(use('skill_043'));
    else await highCountClick(use('skill_043'));
    const statusCall = await finish('move', 'skill_043');
    results.push({ action: 'status', call: statusCall });
    assert.ok(statusCall.events.some(e => e.type === 'stage' && e.side === 'player' && e.stat === 'phy_atk' && e.delta === 1 && e.effect === 'bf_pa_up1'), 'status effect must occur even if an opponent subsequently lowers it');
    await start();
    if (!touch) {
      const r = await id('go-dodge').boundingBox();
      await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2, { delay: 60 });
      if (mode === 'manual') assert.equal(await page.evaluate(() => window.__turnCalls.length), 0, 'dodge double-click must not also select for opponent');
    } else await press(id('go-dodge'));
    results.push({ action: 'dodge', call: await finish('move', 'skill_000') });
    await start();
    await press(id('switchTab'));
    await press(ui.locator('[data-go-switch="1"]'));
    const switched = await finish('switch');
    assert.equal(switched.actions.player.index, 1);
    assert.match(await id('playerHud').textContent(), /カブキジャベリン/);
    results.push({ action: 'switch', call: switched });
    await start();
    const hp = await id('playerHud').textContent();
    await press(open('skill_041'));
    assert.ok(await use('skill_041').isDisabled());
    assert.match(await ui.locator('.go-expanded-move').textContent(), /ENが不足/);
    await press(ui.locator('[data-go-move-back]'));
    assert.equal(await id('playerHud').textContent(), hp);
    assert.equal(await page.evaluate(() => window.__turnCalls.length), 0);
    results.push({ action: 'unavailable-and-back', blocked: true });
    if (!touch) {
      await highCountClick(open('skill_043'));
      assert.ok(await use('skill_043').isVisible(), 'opening details must also allow high click counts');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.__turnCalls.length), 0);
      results.push({ action: 'detail-2-open-and-escape', accepted: true });
    }
    assert.deepEqual(errors, []);
    await writeFile(resolve(artifacts, device + '-' + mode + '.json'), JSON.stringify({ device, mode, results, errors }, null, 2));
    console.log(device + ' / ' + mode + ': ' + results.length + ' input checks passed; attack/status/dodge/switch executed once.');
  } catch (error) {
    const observed = await page.evaluate(() => ({ trace: window.__inputTrace, calls: window.__turnCalls, commandText: document.querySelector("#go-app #moveGrid")?.textContent }));
    await writeFile(resolve(artifacts, device + "-" + mode + "-failure.json"), JSON.stringify(observed, null, 2));
    throw error;
  } finally { await context.close(); }
}

(async () => {
  await mkdir(artifacts, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    if (process.env.GO_EXPECT_INPUT_BUG === '1') await verify(browser, 'mouse', 'manual', true);
    else if (process.env.GO_TEST_STATUSES === '1') for (const device of ['mouse', 'touch']) await verify(browser, device, 'manual');
    else for (const device of ['mouse', 'touch']) for (const mode of ['manual', 'enemy', 'random-enemy']) await verify(browser, device, mode);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
