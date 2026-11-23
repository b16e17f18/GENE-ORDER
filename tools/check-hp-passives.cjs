// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'hp-passive-validation');
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
 const input=page.locator('#files');await input.setInputFiles(['passive_type','passive','element','effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.passive_type?.rows.length===36&&db.passive?.source&&db.element?.source&&db.effect?.source);await page.locator('#tabs').getByRole('button',{name:'passive',exact:true}).click();await page.locator('#new').click();const field=n=>page.getByLabel(n,{exact:true});
 for(const [n,v]of Object.entries({passive_id:'fixture_hp',name:'HP条件検証',passive_type1:'conditional_damage_multiplier',target_id1:'all',value1:'0.5',condition1:'self_hp_eq:1/1',passive_type2:'conditional_stat_multiplier',target_id2:'sa',value2:'1.5',condition2:'self_hp_lte:1/2'}))await field(n).fill(v);
 const options=await field('condition1').evaluate(e=>[...e.list.options].map(o=>o.value));assert.ok(options.includes('self_hp_eq:1/1'));assert.ok(options.includes('self_hp_lte:1/2'));await field('condition1').fill('self_hp_eq:2/1');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー.*condition1/s);await field('condition1').fill('self_hp_eq:1/1');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);
 const pending=page.waitForEvent('download');await page.locator('#export').click();const downloaded=await pending,csv=await readFile(await downloaded.path(),'utf8');await input.setInputFiles({name:'passive.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.passive.dirty&&db.passive.rows.some(r=>r.passive_id==='fixture_hp'));const row=await page.evaluate(()=>db.passive.rows.find(r=>r.passive_id==='fixture_hp'));assert.equal(row.condition1,'self_hp_eq:1/1');assert.equal(row.condition2,'self_hp_lte:1/2');assert.equal(row.value1,'0.5');assert.equal(row.value2,'1.5');assert.equal(await page.evaluate(()=>validate(db.passive,'passive').length),0);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor.png'),fullPage:true});console.log('PASS Edge GOE: 36-type catalog, HP equality/half presets, target/value/condition validation, save/export/reload with exact strings');
 }finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
