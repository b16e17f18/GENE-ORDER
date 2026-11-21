// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'passive28-validation');
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
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:'+server.address().port+'/GO_Editor.html');
 const input=page.locator('#files');await input.setInputFiles(['passive_type','passive','element','effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.passive_type?.rows.length===28&&db.passive?.source&&db.effect?.source&&db.element?.source);await page.locator('#tabs').getByRole('button',{name:'passive',exact:true}).click();await page.locator('#new').click();const field=n=>page.getByLabel(n,{exact:true});
 const list=async n=>field(n).evaluate(e=>[...e.list.options].map(o=>({value:o.value,label:o.label})));
 const types=await list('passive_type1');assert.equal(types.filter(t=>t.value!=='none').length,28);assert.ok(types.find(t=>t.value==='heal_block').label.includes('回復技封印'));assert.ok(types.find(t=>t.value==='heal_block').label.includes('相手'));
 await field('passive_id').fill('fixture_editor');await field('name').fill('GOE複合検証');await field('passive_type1').fill('status_immunity');let targets=await list('target_id1');assert.ok(targets.some(t=>t.value==='sleep'));assert.ok(targets.some(t=>t.value==='all'));assert.equal(targets.some(t=>t.value==='pa'),false);await field('target_id1').fill('pa');await field('value1').fill('0');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);assert.equal(await page.evaluate(()=>db.passive.rows.some(p=>p.passive_id==='fixture_editor')),false);
 await field('passive_type1').fill('damage_lifesteal');targets=await list('target_id1');assert.deepEqual(targets.map(t=>t.value).sort(),['all','physical','special']);await field('target_id1').fill('physical');await field('value1').fill('.25');
 for(const [n,v]of Object.entries({passive_type2:'on_status_stat_stage',target_id2:'sd',value2:'-1',condition2:'sleep',passive_type3:'on_entry_enemy_en_drain',target_id3:'en',value3:'2'}))await field(n).fill(v);await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);
 await page.locator('#clone').click();await field('passive_id').fill('fixture_clone');await field('value1').fill('1.5');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);await field('value1').fill('0');await page.locator('#save').click();
 const pending=page.waitForEvent('download');await page.locator('#export').click();const download=await pending,csv=await readFile(await download.path(),'utf8');await input.setInputFiles({name:'passive.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.passive.dirty&&db.passive.rows.some(r=>r.passive_id==='fixture_clone'));
 const row=await page.evaluate(()=>db.passive.rows.find(r=>r.passive_id==='fixture_clone'));assert.equal(row.value1,'0');assert.equal(row.value2,'-1');assert.equal(row.condition2,'sleep');assert.equal(row.passive_type3,'on_entry_enemy_en_drain');assert.equal(await page.evaluate(()=>validate(db.passive,'passive').length),0);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor.png'),fullPage:true});console.log('PASS Edge GOE: 28 names/descriptions, dynamic target/condition lists, invalid save rejected, create/edit/clone, 3-slot CSV export/reload, signed/zero values');
 }finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
