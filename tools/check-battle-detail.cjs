// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'stage-layout-validation');
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



async function verify(browser,width){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const create=geneOrderBattle.createBattle;geneOrderBattle.createBattle=options=>{const b=create(options);window.__detailBattle=b;for(const side of ['player','enemy']){const f=geneOrderBattle.activeFighter(b,side);f.base={...f.base,phy_atk:81,phy_def:100,sp_atk:120,sp_def:90,speed:60,regen_value:22,energy_charge:2};f.stages.phy_atk=2;f.stages.phy_def=-2;f.statuses=['poison','burn','paralysis','frostbite','sleep'].map(id=>({definition:state.effects.get(id),turns:state.effects.get(id).turn}));}return b;};},{once:true}));
 await page.goto(baseURL);const ui=page.locator('#go-app');const press=locator=>width<700?locator.tap():locator.click();
 await press(ui.locator('#battleModeButton'));await ui.locator('#go-official-mode').selectOption('manual');for(const id of ['015','016','019'])await press(ui.locator('[data-go-pick="character_'+id+'"]'));await press(ui.locator('#setupEnemyModeButton'));await press(ui.locator('[data-go-pick="character_009"]'));await press(ui.locator('#startButton'));await ui.locator('#go-battle-bgm').uncheck();
 for(const side of ['player','enemy']){assert.doesNotMatch(await ui.locator('#'+side+'Hud').textContent(),/状態|睡眠|火やられ|麻痺|毒|氷やられ|ランク|▲|▼/);assert.equal(await ui.locator('#'+side+'Hud .go-hud-ranks, #'+side+'Hud .go-hud-rank-line').count(),0);}assert.equal(await ui.locator('#battleStatusPanel').isVisible(),false);
 const inspect=ui.locator('#enemyInfoPanel');
 for(const side of ['player','enemy']){
   const before=await page.evaluate(()=>JSON.stringify(window.__detailBattle,(_,v)=>v instanceof Map?[...v]:v));await press(ui.locator('#'+side+'Sprite [data-fighter-side]'));
   assert.equal(await inspect.locator('.detail-stat-track,.detail-stat-fill').count(),0);
   const expected=await page.evaluate(side=>{const b=window.__detailBattle,f=geneOrderBattle.activeFighter(b,side),opponent=geneOrderBattle.activeFighter(b,side==='player'?'enemy':'player');return ['phy_atk','phy_def','sp_atk','sp_def','speed'].map(stat=>{const value=stat==='speed'?geneOrderBattle.effectiveSpeed(b,side):geneOrderBattle.statValue(f,stat,{opponent});return {stat,value,grade:goStatRank(stat,value).letter,marks:geneOrderUI.stageMarks(f.stages[stat])};});},side);
   for(const {stat,value,grade,marks} of expected){const row=inspect.locator('.detail-stat-'+stat);assert.equal(await row.locator('.detail-stat-grade').textContent(),grade);assert.equal(await row.locator('.go-battle-stage').textContent(),marks);assert.equal(await row.locator('.go-stage-slot').count(),6);if(side==='player')assert.equal(await row.locator('.detail-stat-value').textContent(),String(value));else assert.equal(await row.locator('.detail-stat-value').count(),0);}
   const geometry=await inspect.locator('.go-battle-stat:not(.detail-stat-regen_value)').evaluateAll(rows=>rows.map(row=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};return {label:rect(row.querySelector('.detail-stat-label')),stage:rect(row.querySelector('.go-battle-stage')),grade:rect(row.querySelector('.detail-stat-grade')),slots:[...row.querySelectorAll('.go-stage-slot')].map(rect)};}));
   for(const row of geometry){assert.ok(row.label.right<=row.stage.left);assert.ok(row.stage.right<=row.grade.left);assert.ok(row.grade.left-row.stage.right<=16);assert.ok(Math.abs(row.stage.left-geometry[0].stage.left)<1);assert.ok(Math.abs(row.grade.left-geometry[0].grade.left)<1);for(const slot of row.slots)assert.ok(Math.abs(slot.width-row.slots[0].width)<.2);assert.ok(Math.abs(row.stage.top-row.grade.top)<5);}
   assert.equal(await inspect.locator('.go-stage-up').first().evaluate(e=>getComputedStyle(e).color),'rgb(255, 60, 168)');assert.equal(await inspect.locator('.go-stage-down').first().evaluate(e=>getComputedStyle(e).color),'rgb(23, 105, 255)');assert.equal(await inspect.locator('.go-stage-empty').first().evaluate(e=>getComputedStyle(e).color),'rgb(119, 119, 119)');
   for(let i=0;i<5;i++){const actual=await inspect.locator('.effect-chip').nth(i).evaluate(e=>({color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));const reference=await page.evaluate(i=>{const id=['poison','burn','paralysis','frostbite','sleep'][i],node=document.createElement('span');node.className='effect-chip '+effectChipClass(id);document.body.append(node);const style=getComputedStyle(node),result={color:style.color,bg:style.backgroundColor};node.remove();return result;},i);assert.deepEqual(actual,reference);}
   if(side==='enemy'){assert.equal(await inspect.locator('.detail-stat-value').count(),0);assert.doesNotMatch(await inspect.textContent(),/回避率|回復力|EN回復/);assert.equal(await inspect.locator('.detail-stat-label').count(),5);}else{assert.match(await inspect.textContent(),/回避率/);assert.match(await inspect.textContent(),/EN回復/);assert.equal(await inspect.locator('.detail-stat-regen_value .detail-stat-value').textContent(),'22');}
   assert.equal(await page.evaluate(()=>JSON.stringify(window.__detailBattle,(_,v)=>v instanceof Map?[...v]:v)),before);
   assert.equal(await inspect.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:resolve(artifacts,side+'-'+width+'.png'),fullPage:true});await press(ui.locator('[data-go-inspect-back]'));
 }
 await page.evaluate(()=>{const f=geneOrderBattle.activeFighter(window.__detailBattle,'enemy');f.statuses=f.statuses.filter(s=>s.definition.effect_id!=='burn');});await press(ui.locator('#enemySprite [data-fighter-side]'));assert.equal(await inspect.locator('.detail-stat-phy_atk .detail-stat-grade').textContent(),'S');assert.equal(await inspect.locator('.detail-stat-value').count(),0);await press(ui.locator('[data-go-inspect-back]'));
 await page.evaluate(()=>geneOrderBattle.activeFighter(window.__detailBattle,'enemy').stages.phy_atk=-2);await press(ui.locator('#enemySprite [data-fighter-side]'));assert.equal(await inspect.locator('.detail-stat-phy_atk .detail-stat-grade').textContent(),'G');assert.equal(await inspect.locator('.detail-stat-phy_atk .go-battle-stage').textContent(),'▼▼・・・・');assert.deepEqual(errors,[]);
 await context.close();console.log('PASS Edge '+width+': six equal slots, colors, left alignment, grade adjacent/no overlap, detail-only ranks, hidden opponent values, MHB status colors, no state mutation/overflow');
}
let baseURL;
(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});for(const width of [1280,390])await verify(browser,width);}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
