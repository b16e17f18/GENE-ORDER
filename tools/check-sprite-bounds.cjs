// Usage: GO_PLAYWRIGHT_PATH=... node tools/check-input.cjs
// GO_EXPECT_INPUT_BUG=1 records the unfixed PC double-click rejection.
const { chromium } = require(process.env.GO_PLAYWRIGHT_PATH || 'playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = resolve(root, '.cache', 'sprite-center-validation');
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




(async()=>{await mkdir(artifacts,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL='http://127.0.0.1:'+server.address().port;let browser;let checks=0;try{browser=await chromium.launch({channel:'msedge',headless:true});const files=(await require('node:fs/promises').readdir(resolve(root,'asset/character'))).filter(f=>f.endsWith('.png'));
for(const [width,height]of [[1280,900],[1920,1080],[768,1024],[900,500],[600,900],[390,844],[844,390]]){const mobile=(width<=600&&height>=width)||(width<=900&&width>height),context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(baseURL);const ui=page.locator('#go-app');await ui.locator('#battleModeButton').click();await ui.locator('#go-official-mode').selectOption('manual');for(const id of ['015','016','019'])await ui.locator('[data-go-pick="character_'+id+'"]').click();await ui.locator('#setupEnemyModeButton').click();await ui.locator('[data-go-pick="character_009"]').click();await ui.locator('#startButton').click();await ui.locator('#go-battle-bgm').uncheck();
async function inspect(src,file){return page.evaluate(async({src,file})=>{const field=document.querySelector('#go-app .battle-field'),stage=field.getBoundingClientRect(),mid=(stage.left+stage.right)/2;const results=[];for(const [id,side]of [['playerSprite','player'],['enemySprite','enemy']]){const image=document.querySelector('#'+id+' img'),wrap=image.closest('.sprite-image-wrap');for(const cls of [...wrap.classList])if(cls.startsWith('sprite-character_'))wrap.classList.remove(cls);wrap.classList.add('sprite-'+file.replace('.png',''));image.src=src;if(!image.complete)await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});if(!image.naturalWidth)throw Error('Image failed: '+src);image.style.setProperty('--go-source-width',image.naturalWidth+'px');await new Promise(r=>requestAnimationFrame(r));const box=image.getBoundingClientRect();results.push({side,left:box.left,right:box.right,width:box.width,height:box.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,mid});}return results;},{src,file});}
function verify(results){for(const b of results){assert.ok(b.side==='player'?b.right<=b.mid+.5:b.left>=b.mid-.5,'center overflow '+JSON.stringify(b));assert.ok(b.width<=b.naturalWidth+.5,'image enlarged');assert.ok(b.height<=b.naturalHeight+.5,'image enlarged vertically');assert.ok(Math.abs(b.width/b.height-b.naturalWidth/b.naturalHeight)<.01,'aspect ratio changed');if(mobile)assert.ok(b.width<=(width<=600&&height>=width?140:180)+.5);checks++;}}
for(const file of files)verify(await inspect(baseURL+'/asset/character/'+file,file));const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240" fill="gray"/></svg>');verify(await inspect(svg,'fixture.png'));const actual=await inspect(baseURL+'/asset/character/character_011.png','character_011.png');verify(actual);if(!mobile&&width>=1280)assert.ok(Math.abs(actual[0].width-330)<.5,'PC is not displaying native width');assert.deepEqual(errors,[]);await page.screenshot({path:resolve(artifacts,width+'x'+height+'.png'),fullPage:true});console.log('PASS '+width+'x'+height+': '+files.length+' files + oversized fixture; largest actual image width '+actual[0].width);await context.close();}
console.log('PASS '+checks+' image-boundary/aspect/native-size checks');}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
