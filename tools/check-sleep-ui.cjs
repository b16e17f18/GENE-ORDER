// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'sleep-validation');
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



async function verify(browser,width,targetSleeping){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({targetSleeping})=>document.addEventListener('DOMContentLoaded',()=>{
   Math.random=()=>.99;
   const create=geneOrderBattle.createBattle;
   geneOrderBattle.createBattle=options=>{const b=create(options);window.__sleepBattle=b;const side=targetSleeping?'enemy':'player';const f=geneOrderBattle.activeFighter(b,side);f.statuses.push({definition:state.effects.get('sleep'),turns:state.effects.get('sleep').turn});f.energy=7;
     if(targetSleeping){f.hp=f.maxHp=2000;f.base={...f.base,speed:1};b.skills=new Map(b.skills);b.skills.set('skill_031',{...b.skills.get('skill_031'),priority:-1});}
     return b;};
   const resolve=geneOrderBattle.resolveTurn;geneOrderBattle.resolveTurn=(b,actions)=>{const result=resolve(b,actions);window.__sleepResult=result;return result;};
 },{once:true}),{targetSleeping});
 await page.goto(baseURL);const ui=page.locator('#go-app');const press=locator=>width<700?locator.tap():locator.click();
 await press(ui.locator('#battleModeButton'));await ui.locator('#go-official-mode').selectOption('manual');for(const id of ['015','016','019'])await press(ui.locator('[data-go-pick="character_'+id+'"]'));await press(ui.locator('#setupEnemyModeButton'));await press(ui.locator('[data-go-pick="character_009"]'));await press(ui.locator('#startButton'));await ui.locator('#go-fast-battle').check();await ui.locator('#go-battle-bgm').uncheck();
 const side=targetSleeping?'enemy':'player';assert.doesNotMatch(await ui.locator('#'+side+'Hud').textContent(),/睡眠|状態/);
 await press(ui.locator('#'+side+'Sprite [data-fighter-side]'));assert.match(await ui.locator('#enemyInfoPanel').textContent(),/睡眠（3）/);await press(ui.locator('[data-go-inspect-back]'));
 await press(ui.locator('[data-go-open-move="skill_002"]'));await press(ui.locator('[data-go-move="skill_002"]'));
 if(targetSleeping){await press(ui.locator('[data-go-open-move="skill_031"]'));await press(ui.locator('[data-go-move="skill_031"]'));}else await press(ui.locator('#go-dodge'));
 await page.waitForFunction(()=>window.__sleepBattle.turn===2&&!document.querySelector('#go-app #go-dodge').disabled);
 const out=await page.evaluate(()=>({events:window.__sleepResult.events,statuses:geneOrderBattle.activeFighter(window.__sleepBattle,window.__sleepResult.events.some(e=>e.type==='awakened')?'enemy':'player').statuses.map(s=>s.definition.effect_id),energy:geneOrderBattle.activeFighter(window.__sleepBattle,'player').energy}));
 const log=await ui.locator('#go-official-log').textContent();
 if(targetSleeping){assert.equal(out.events.filter(e=>e.type==='awakened').length,1);assert.ok(out.events.findIndex(e=>e.type==='awakened')<out.events.findIndex(e=>e.type==='move'&&e.side==='enemy'));assert.match(log,/目を覚ました/);assert.equal(out.statuses.includes('sleep'),false);assert.doesNotMatch(await ui.locator('#enemyHud').textContent(),/睡眠/);}
 else {assert.ok(out.events.some(e=>e.type==='action-failed'&&e.side==='player'));assert.equal(out.events.some(e=>e.type==='move'&&e.side==='player'),false);assert.equal(out.energy,7);assert.match(log,/睡眠.*EN消費なし/);assert.doesNotMatch(await ui.locator('#playerHud').textContent(),/睡眠|状態/);await press(ui.locator('#playerSprite [data-fighter-side]'));assert.match(await ui.locator('#enemyInfoPanel').textContent(),/睡眠（2）/);}
 await page.screenshot({path:resolve(artifacts,(targetSleeping?'wake-':'asleep-')+width+'.png'),fullPage:true});assert.deepEqual(errors,[]);await context.close();console.log('PASS Edge '+width+' '+(targetSleeping?'body hit wakes enemy before its action':'sleep HUD/detail, blocked move, no EN payment'));
}
let baseURL;
(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});for(const width of [1280,390])for(const targetSleeping of [false,true])await verify(browser,width,targetSleeping);}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
