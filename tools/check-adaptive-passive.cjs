// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'adaptive-passive-validation');
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





(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});for(const width of [1280,390]){const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:'+server.address().port+'/GO_Editor.html');const input=page.locator('#files');await input.setInputFiles(['passive_type','passive','element','effect'].map(n=>resolve(root,'data',n+'.csv')));await page.waitForFunction(()=>db.passive_type?.rows.length===37&&db.passive?.source&&db.element?.source&&db.effect?.source);await page.locator('#tabs').getByRole('button',{name:'passive',exact:true}).click();await page.locator('#new').click();const field=n=>page.getByLabel(n,{exact:true});for(const [n,v]of Object.entries({passive_id:'fixture_uma',name:'未確認生物検証',passive_type1:'adaptive_stat_multiplier',target_id1:'auto',value1:'1.5',condition1:''}))await field(n).fill(v);const options=await field('target_id1').evaluate(e=>[...e.list.options].map(o=>o.value));assert.deepEqual(options,['auto']);const names=await field('passive_type1').evaluate(e=>[...e.list.options].map(o=>({value:o.value,label:o.label})));assert.ok(names.find(o=>o.value==='adaptive_stat_multiplier').label.includes('最大能力差'));await field('target_id1').fill('pa');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/検証エラー/);await field('target_id1').fill('auto');await page.locator('#save').click();assert.match(await page.locator('#msg').textContent(),/登録しました/);await page.locator('#clone').click();await field('passive_id').fill('fixture_clone');await field('value1').fill('2');await page.locator('#save').click();const pending=page.waitForEvent('download');await page.locator('#export').click();const output=await pending,csv=await readFile(await output.path(),'utf8');await input.setInputFiles({name:'passive.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForFunction(()=>!db.passive.dirty&&db.passive.rows.some(r=>r.passive_id==='fixture_clone'));const stored=await page.evaluate(()=>({original:db.passive.rows.find(r=>r.passive_id==='passive_035'),fixture:db.passive.rows.find(r=>r.passive_id==='fixture_uma'),clone:db.passive.rows.find(r=>r.passive_id==='fixture_clone'),issues:validate(db.passive,'passive')}));assert.equal(stored.original.name,'謎の遺伝子');assert.equal(stored.fixture.target_id1,'auto');assert.equal(stored.fixture.value1,'1.5');assert.equal(stored.fixture.condition1,'');assert.equal(stored.clone.value1,'2');assert.deepEqual(stored.issues,[]);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,'editor-'+width+'.png'),fullPage:true});await context.close();console.log('PASS Edge GOE '+width+': adaptive auto, invalid target rejected, edit/clone/export/reload');}}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
