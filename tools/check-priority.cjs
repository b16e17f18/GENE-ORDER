// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'priority-validation');
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






(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});for(const width of [1280,390]){const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:'+server.address().port+'/GO_Editor.html');const input=page.locator('#files');await input.setInputFiles(['passive_type','passive','element','effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.passive_type?.rows.length===36&&db.passive?.source&&db.element?.source&&db.effect?.source);await page.locator('#tabs').getByRole('button',{name:'passive',exact:true}).click();await page.locator('#new').click();const field=n=>page.getByLabel(n,{exact:true});for(const [n,v]of Object.entries({passive_id:'fixture_priority',name:'優先度検証',passive_type1:'conditional_priority_modifier',target_id1:'attack',value1:'1',condition1:'self_hp_reached_lte:1/2&once_per_battle',passive_type2:'conditional_priority_modifier',target_id2:'status',value2:'-1',condition2:'first_move_after_entry',passive_type3:'conditional_priority_modifier',target_id3:'special',value3:'0',condition3:''}))await field(n).fill(v);const targets=await field('target_id1').evaluate(e=>[...e.list.options].map(o=>o.value).sort());assert.deepEqual(targets,['all','attack','physical','special','status']);const conditions=await field('condition1').evaluate(e=>[...e.list.options].map(o=>o.value));assert.ok(conditions.includes('self_hp_reached_lte:1/2&once_per_battle'));await field('value1').fill('.5');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);await field('value1').fill('1');await field('condition1').fill('unknown');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);await field('condition1').fill('self_hp_reached_lte:1/2&once_per_battle');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);const pending=page.waitForEvent('download');await page.locator('#export').click();const output=await pending,csv=await readFile(await output.path(),'utf8');await input.setInputFiles({name:'passive.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.passive.dirty&&db.passive.rows.some(r=>r.passive_id==='fixture_priority'));const stored=await page.evaluate(()=>({row:db.passive.rows.find(r=>r.passive_id==='fixture_priority'),issues:validate(db.passive,'passive')}));assert.equal(stored.row.condition1,'self_hp_reached_lte:1/2&once_per_battle');assert.equal(stored.row.value2,'-1');assert.equal(stored.row.value3,'0');assert.equal(stored.row.condition3,'');assert.deepEqual(stored.issues,[]);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor-'+width+'.png'),fullPage:true});await context.close();console.log('PASS Edge GOE '+width+': five targets, HP-history AND once condition, signed integer/zero, invalid settings rejected, CSV roundtrip');}}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
