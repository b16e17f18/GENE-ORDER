
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const html=readFileSync(new URL('../GO_Editor.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].split("$('load').onclick")[0];
const ctx=vm.createContext({document:{getElementById(){return {}}}});vm.runInContext(script,ctx);
const run=s=>vm.runInContext(s,ctx);
const csv=readFileSync(new URL('../data/effect.csv',import.meta.url),'utf8');ctx.csv=csv;
run("db.effect=parse(csv);tab='effect'");
test('GOE enables effect creation, edit, clone and export via common editable schema',()=>{assert.equal(run("editable.includes('effect')"),true);assert.equal(run("refs.includes('effect')"),false);assert.equal(run("db.effect.headers.length"),13);assert.equal(run("schemas.effect"),run("db.effect.headers.join(',')"));});
test('GOE loads six EN rows and retains signed and zero values',()=>{for(const [id,value] of [['en_down1','-1'],['en_down2','-2'],['en_charge_zero','0'],['en_cost_up1','1']])assert.equal(run('db.effect.rows.find(r=>r.effect_id==='+JSON.stringify(id)+').damage_value'),value);assert.equal(run("validate(db.effect,'effect').length"),0);});
test('GOE unedited CSV roundtrip is byte-exact',()=>{assert.equal(run('serialize(db.effect)'),csv);});
test('GOE edited export roundtrip preserves every column including negative, zero, blanks and Unicode',()=>{run("testCopy=parse(csv);testCopy.dirty=true;testCopy.rows.find(r=>r.effect_id==='en_cost_up1').damage_value='2';roundtrip=parse(serialize(testCopy))");assert.equal(run("JSON.stringify(testCopy.rows)"),run("JSON.stringify(roundtrip.rows)"));assert.equal(run("roundtrip.rows.find(r=>r.effect_id==='en_charge_zero').damage_value"),'0');});
test('GOE accepts all EN group/target choices without rejecting custom identifiers',()=>{for(const group of ['en_drain','en_charge_modifier','en_cost_modifier'])assert.equal(run('choices("effect_group").has('+JSON.stringify(group)+')'),true);assert.equal(run("choices('target_stat').has('cost_charge')"),true);assert.equal(run("choices('effect_target1').has('enemy')"),true);});
test('GOE detects invalid numbers/durations while allowing negative effect magnitude',()=>{run("bad=parse(csv);bad.rows.find(r=>r.effect_id==='en_down1').damage_value='-4'");assert.equal(run("validate(bad,'effect').length"),0);run("bad.rows.find(r=>r.effect_id==='en_cost_up1').turn='0'");assert.ok(run("validate(bad,'effect').length")>0);run("bad.rows.find(r=>r.effect_id==='en_down1').damage_value='NaN'");assert.ok(run("validate(bad,'effect').some(e=>e.includes('damage_value'))"));});
test('GOE accepts blank lines and CRLF without corrupting structured rows',()=>{ctx.lines=csv.replaceAll('\n','\r\n')+'\r\n';assert.equal(run('parse(lines).rows.length'),run('db.effect.rows.length'));assert.equal(run('serialize(parse(lines))'),ctx.lines);});
