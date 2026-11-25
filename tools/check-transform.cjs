// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-fields.cjs
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'transform-validation');
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




let baseURL;
async function editor(browser,width,attack=false){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(baseURL+'/GO_Editor.html');const input=page.locator('#files');
 await input.setInputFiles(['effect','skill','element','battle_effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.effect?.source&&db.skill?.source&&db.element?.source&&db.battle_effect?.source);
 await page.locator('#tabs').getByRole('button',{name:'skill',exact:true}).click();await page.locator('#new').click();const field=n=>page.getByLabel(n,{exact:true});
 const settings={skill_id:'fixture_editor_transform',name:'へんしん',category:'status',power:'0',element:'無',element2:'none',attack_type:'none',hit_type:'normal',effect1:'transform',effect_target1:'enemy',effect_chance1:'100',target:'enemy',priority:'0',cost:'3'};
 if(attack)Object.assign(settings,{category:'attack',power:'40',attack_type:'physical'});
 for(const [n,v]of Object.entries(settings))await field(n).fill(v);assert.ok(await field('effect1').evaluate(e=>[...e.list.options].some(o=>o.value==='transform')));await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);
 const pending=page.waitForEvent('download');await page.locator('#export').click();const output=await pending,csv=await readFile(await output.path(),'utf8');await input.setInputFiles({name:'skill.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.skill.dirty&&db.skill.rows.some(r=>r.skill_id==='fixture_editor_transform'));const stored=await page.evaluate(()=>db.skill.rows.find(r=>r.skill_id==='fixture_editor_transform'));for(const [n,v]of Object.entries(settings))assert.equal(stored[n],v);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor-'+(attack?'attack-':'status-')+width+'.png'),fullPage:true});await context.close();console.log('PASS Edge GOE '+(attack?'attack ':'status ')+width+': transform choice, create/save/export/reload, EN cost unchanged');
}
async function battleUI(browser,width,attack=false){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(attack=>document.addEventListener('DOMContentLoaded',()=>{const original=geneOrderBattle.createBattle;geneOrderBattle.createBattle=options=>{
  const b=original(options),f=geneOrderBattle.activeFighter(b,'player'),e=geneOrderBattle.activeFighter(b,'enemy');window.__transformBattle=b;
  for(const a of [f,e]){a.hp=a.maxHp=1000;a.base={...a.base,regen_value:0,energy_charge:0,evasion_percent:0};a.passive=null;a.passiveEffects=[];}
  f.base={...f.base,phy_atk:50,skillIds:['fixture_transform']};f.energy=7;e.base={...e.base,phy_atk:170,skillIds:['fixture_copied']};e.passive=state.passives.get('passive_043');e.passiveEffects=e.passive.effects;
  b.skills.set('fixture_transform',{skill_id:'fixture_transform',name:'へんしん検証',category:attack?'attack':'status',power:attack?40:0,attack_type:attack?'physical':'none',element:'none',hit_type:'normal',cost:2,priority:0,effect1:'transform',effect_target1:'enemy',effect_chance1:100,text:'相手にへんしんする。'});
  b.skills.set('fixture_copied',{skill_id:'fixture_copied',name:'コピーした技',category:'attack',power:60,attack_type:'physical',element:'water',hit_type:'normal',cost:0,priority:0,text:'検証用'});state.skills=b.skills;return b;
 };},{once:true}),attack);
 await page.goto(baseURL);const ui=page.locator('#go-app');await ui.locator('#battleModeButton').click();await ui.locator('#go-official-mode').selectOption('manual');for(const id of ['015','016','019'])await ui.locator('[data-go-pick="character_'+id+'"]').click();await ui.locator('#setupEnemyModeButton').click();await ui.locator('[data-go-pick="character_009"]').click();await ui.locator('#startButton').click();await ui.locator('#go-fast-battle').check();await ui.locator('#go-battle-bgm').uncheck();
 const before=await ui.locator('#playerSprite img').getAttribute('src'),target=await ui.locator('#enemySprite img').getAttribute('src');assert.notEqual(before,target);
 async function act(id){await ui.locator('[data-go-open-move="'+id+'"]').click();await ui.locator('[data-go-move="'+id+'"]').click();if((await ui.locator('#moveGrid').textContent()).includes('相手の行動')){if(attack&&id==='fixture_transform'){await ui.locator('[data-go-open-move="fixture_copied"]').click();await ui.locator('[data-go-move="fixture_copied"]').click();}else await ui.locator('#go-dodge').click();}await page.waitForFunction(()=>!document.querySelector('#go-app #go-dodge').disabled);}
 await act('fixture_transform');await page.waitForFunction(()=>window.__transformBattle.turn>=2);assert.equal(await ui.locator('#playerSprite img').getAttribute('src'),target);assert.equal(await ui.locator('[data-go-open-move="fixture_copied"]').count(),1);assert.equal(await ui.locator('[data-go-open-move="fixture_transform"]').count(),0);assert.match(await ui.locator('#go-official-log').textContent(),/へんしんした/);
 await ui.locator('#playerSprite [data-fighter-side]').click();assert.match(await ui.locator('#enemyInfoPanel').textContent(),/へんしん/);assert.match(await ui.locator('#enemyInfoPanel').textContent(),/超適応/);await page.screenshot({path:resolve(artifacts,'battle-'+(attack?'attack-':'status-')+width+'.png'),fullPage:true});await ui.locator('[data-go-inspect-back]').click();
 await act('fixture_copied');await page.waitForFunction(()=>window.__transformBattle.turn>=3);const stats=await page.evaluate(()=>{const f=geneOrderBattle.activeFighter(window.__transformBattle,'player');return {pa:geneOrderBattle.battleBase(f).phy_atk,maxHp:f.maxHp,basePa:f.base.phy_atk,elements:geneOrderBattle.currentElements(f)};});assert.equal(stats.pa,170);assert.equal(stats.maxHp,1000);assert.equal(stats.basePa,50);assert.deepEqual(stats.elements,['water']);assert.deepEqual(errors,[]);await context.close();console.log('PASS Edge battle '+(attack?'attack ':'status ')+width+': appearance/current moves/passive detail, copied attack, super adaptation');
}
(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});for(const width of [1280,390]){for(const attack of [false,true]){await editor(browser,width,attack);await battleUI(browser,width,attack);}}}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
