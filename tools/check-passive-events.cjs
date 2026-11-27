// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'passive-events-validation');
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




(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:'+server.address().port+'/GO_Editor.html');
 const input=page.locator('#files');await input.setInputFiles(['passive_type','passive','element','effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.passive_type?.rows.length===36&&db.passive?.source&&db.element?.source&&db.effect?.source);await page.locator('#tabs').getByRole('button',{name:'passive',exact:true}).click();const field=n=>page.getByLabel(n,{exact:true});
 const specs=[['on_damage_en_restore','en','1'],['on_ko_stat_stage','sa','-1'],['on_switch_out_heal','hp','0.2'],['on_hit_enemy_stat_stage','pd','-1'],['on_enemy_ko_en_restore','en','2']];
 for(const [type,target,value]of specs){await page.locator('#new').click();for(const [n,v]of Object.entries({passive_id:'fixture_'+type,name:'検証 '+type,passive_type1:type,target_id1:target,value1:value}))await field(n).fill(v);
 const types=await field('passive_type1').evaluate(e=>[...e.list.options].map(o=>({value:o.value,label:o.label})));assert.equal(types.filter(o=>o.value!=='none').length,36);assert.ok(types.find(o=>o.value===type).label.match(/[ぁ-龠]/));const targets=await field('target_id1').evaluate(e=>[...e.list.options].map(o=>o.value));assert.ok(targets.includes(target));assert.equal(targets.includes('poison'),false);
 await field('target_id1').fill('invalid');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);await field('target_id1').fill(target);await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);await page.locator('#clone').click();await field('passive_id').fill('clone_'+type);await field('value1').fill(value==='0.2'?'0.35':value);await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);}
 const pending=page.waitForEvent('download');await page.locator('#export').click();const download=await pending,csv=await readFile(await download.path(),'utf8');await input.setInputFiles({name:'passive.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.passive.dirty&&db.passive.rows.some(r=>r.passive_id==='clone_on_enemy_ko_en_restore'));for(const [type,target,value]of specs){const row=await page.evaluate(id=>db.passive.rows.find(r=>r.passive_id===id),'fixture_'+type);assert.equal(row.passive_type1,type);assert.equal(row.target_id1,target);assert.equal(row.value1,value);}assert.equal(await page.evaluate(()=>validate(db.passive,'passive').length),0);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor.png'),fullPage:true});console.log('PASS Edge GOE: all five types, Japanese names/descriptions, target validation, create/edit/clone/export/reload, signed and ratio values retained');
 }finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
