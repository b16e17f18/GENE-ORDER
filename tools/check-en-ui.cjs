// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'en-validation');
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


async function editor(browser){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(baseURL+'/GO_Editor.html');
 const input=page.locator('#files');await input.setInputFiles([resolve(root,'data/effect.csv'),resolve(root,'data/skill.csv')]);await page.waitForFunction(()=>db.effect?.source&&db.skill?.source,{},{timeout:5000}).catch(async e=>{throw Error(await page.locator('#msg').textContent()+' '+errors.join(';'));});
 await page.locator('#tabs').getByRole('button',{name:'effect',exact:true}).click();
 const field=name=>page.getByLabel(name,{exact:true});
 await page.locator('#new').click();
 for(const [name,value] of Object.entries({effect_id:'fixture_en_zero',name:'検証用EN補正',effect_group:'en_cost_modifier',damage_type:'none',damage_value:'0',turn:'3',target_stat:'en',can_move:'TRUE'}))await field(name).fill(value);
 await page.locator('#save').click();
 await page.locator('#clone').click();await field('effect_id').fill('fixture_en_negative');await field('damage_value').fill('-1');await page.locator('#save').click();
 await field('turn').fill('4');await page.locator('#save').click();
 let download=page.waitForEvent('download');await page.locator('#export').click();let output=await download;const exportedEffect=await readFile(await output.path(),'utf8');
 assert.match(exportedEffect,/fixture_en_zero,検証用EN補正,en_cost_modifier,none,0,3/);assert.match(exportedEffect,/fixture_en_negative,検証用EN補正,en_cost_modifier,none,-1,4/);
 await page.locator('#tabs').getByRole('button',{name:'skill',exact:true}).click();
 for(const [slot,id,target,chance] of [[1,'en_down1','enemy','100'],[2,'en_drain1','enemy','50'],[3,'fixture_en_zero','self','0']]){await field('effect'+slot).fill(id);await field('effect_target'+slot).fill(target);await field('effect_chance'+slot).fill(chance);}
 await page.locator('#save').click();download=page.waitForEvent('download');await page.locator('#export').click();output=await download;const exportedSkill=await readFile(await output.path(),'utf8');
 await input.setInputFiles([{name:'effect.csv',mimeType:'text/csv',buffer:Buffer.from(exportedEffect)},{name:'skill.csv',mimeType:'text/csv',buffer:Buffer.from(exportedSkill)}]);
 await page.waitForFunction(()=>db.effect.rows.some(r=>r.effect_id==='fixture_en_negative')&&!db.effect.dirty&&!db.skill.dirty);
 const stored=await page.evaluate(()=>({effect:db.effect.rows.find(r=>r.effect_id==='fixture_en_negative'),zero:db.effect.rows.find(r=>r.effect_id==='fixture_en_zero'),skill:db.skill.rows[0],errors:validate(db.effect,'effect')}));
 assert.equal(stored.effect.damage_value,'-1');assert.equal(stored.effect.turn,'4');assert.equal(stored.zero.damage_value,'0');assert.equal(stored.skill.effect1,'en_down1');assert.equal(stored.skill.effect_target3,'self');assert.equal(stored.skill.effect_chance3,'0');assert.deepEqual(stored.errors,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:resolve(artifacts,'editor.png'),fullPage:true});await page.close();console.log('PASS Edge GOE: create/edit/clone, effect slots/target/chance, export/import, signed/zero/duration retention');
}
async function battleUI(browser,width){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
   const create=geneOrderBattle.createBattle;
   geneOrderBattle.createBattle=options=>{const battle=create(options);window.__enBattle=battle;const f=geneOrderBattle.activeFighter(battle,'player');f.energy=7;const target=geneOrderBattle.activeFighter(battle,'enemy');target.energy=6;target.base={...target.base,energy_charge:0};f.base={...f.base,skillIds:['fixture_debuff','fixture_hit'],passive_id:null};
     battle.skills.set('fixture_debuff',{skill_id:'fixture_debuff',name:'EN妨害検証',category:'status',attack_type:'none',element:'none',power:0,cost:0,priority:5,hit_type:'normal',effect1:'en_charge_zero',effect_target1:'self',effect_chance1:100,effect2:'en_cost_up1',effect_target2:'self',effect_chance2:100,effect3:'en_down2',effect_target3:'enemy',effect_chance3:100,text:'検証用'});
     battle.skills.set('fixture_hit',{skill_id:'fixture_hit',name:'EN消費検証',category:'attack',attack_type:'physical',element:'none',power:50,cost:0,priority:0,hit_type:'normal',text:'検証用'});
     state.skills=battle.skills;return battle;};
 },{once:true}));
 await page.goto(baseURL);
 const ui=page.locator('#go-app');await ui.locator('#battleModeButton').click();await ui.locator('#go-official-mode').selectOption('manual');for(const id of ['015','016','019'])await ui.locator('[data-go-pick="character_'+id+'"]').click();await ui.locator('#setupEnemyModeButton').click();await ui.locator('[data-go-pick="character_009"]').click();await ui.locator('#startButton').click();await ui.locator('#go-fast-battle').check();await ui.locator('#go-battle-bgm').uncheck();
 await ui.locator('[data-go-open-move="fixture_debuff"]').click();await ui.locator('[data-go-move="fixture_debuff"]').click();
 // Manual mode asks for the other side. Common dodge is always available.
 if((await ui.locator('#moveGrid').textContent()).includes('相手の行動'))await ui.locator('#go-dodge').click();
 await page.waitForFunction(()=>window.__enBattle.turn>=2);await page.waitForFunction(()=>!document.querySelector('#go-app #go-dodge').disabled);
 assert.equal(await page.evaluate(()=>geneOrderBattle.activeFighter(window.__enBattle,'player').energy),7);
 assert.match(await ui.locator('#go-official-log').textContent(),/EN自然回復無効|消費EN1増加/);assert.equal(await page.evaluate(()=>geneOrderBattle.activeFighter(window.__enBattle,'enemy').energy),4);assert.match(await ui.locator('#enemyHud').textContent(),/4\/7/);
 const card=ui.locator('[data-go-open-move="fixture_hit"]');await card.waitFor();await card.click();assert.equal(await ui.locator('[data-go-move="fixture_hit"] .move-cost .energy-orb').count(),1);
 await ui.locator('[data-go-move-back]').click();await ui.locator('#playerSprite [data-fighter-side]').click();
 const info=await ui.locator('#enemyInfoPanel').textContent();assert.match(info,/EN自然回復無効/);assert.match(info,/消費EN1増加/);assert.match(info,/0 EN \/ ターン/);
 assert.equal(await ui.locator('#enemyInfoPanel .effect-chip').first().evaluate(e=>getComputedStyle(e).color),'rgb(17, 17, 17)');await page.screenshot({path:resolve(artifacts,'battle-'+width+'.png'),fullPage:true});await page.evaluate(()=>geneOrderBattle.activeFighter(window.__enBattle,'player').energy=0);await ui.locator('[data-go-inspect-back]').click();await ui.locator('[data-go-open-move="fixture_hit"]').click();assert.equal(await ui.locator('[data-go-move="fixture_hit"]').isDisabled(),true);assert.deepEqual(errors,[]);await context.close();console.log('PASS Edge battle '+width+': adjusted cost, immediate EN, persistent modifier details/logs');
}
let baseURL;
(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port;let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});await editor(browser);for(const width of [1280,390])await battleUI(browser,width);}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
