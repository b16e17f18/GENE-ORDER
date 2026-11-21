import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const ctx = vm.createContext({ document: { addEventListener() {} } });
for (const file of ['data-validation.js','passive.js','battle-core.js','battle-ai.js','bgm.js','dialogue-manager.js','app.js']) vm.runInContext(read(file), ctx, { filename: file });
const get = name => vm.runInContext(name, ctx);
const go = get('geneOrderBattle'), ai = get('geneOrderAI');
const rows = name => get('rowsFromCsv')(read('data/' + name + '.csv'));
const elements = get('masterIdLookup')(rows('element'), 'element_id');
const chart = new Map();
for (const r of rows('element_effectiveness')) { if (!chart.has(r.attack_element)) chart.set(r.attack_element,new Map()); chart.get(r.attack_element).set(r.defense_element,Number(r.multiplier)); }
const effects = new Map(rows('effect').map(r => [r.effect_id,get('normalizeEffect')(r)]));
const defenses = new Map(rows('battle_effect').map(r => [r.battle_effect_id,get('normalizeBattleEffect')(r)]));
const powerRules = new Map();
for(const row of rows('power_rule').map(get('normalizePowerRule'))) { if(!powerRules.has(row.power_rule_group))powerRules.set(row.power_rule_group,[]);powerRules.get(row.power_rule_group).push(row); }
const skills = new Map(rows('skill').filter(r => r.name).map(r => [r.skill_id,get('normalizeSkill')(r,elements)]));
const types = get('geneOrderPassives.readTypes')(rows('passive_type'));
const statusIds = get('geneOrderStatusIds')([...effects.values()]);
const passives = new Map(rows('passive').filter(r => r.name).map(r => [r.passive_id,get('geneOrderPassives.normalize')(r,elements,statusIds,types)]));
Object.assign(get('state'), { effects, battleEffects: defenses, skills, passives });
const strike = { skill_id: 'attack',name:'Attack',category:'attack',attack_type:'physical',element:'none',element2:null,power:80,cost:2,priority:0,hit_type:'normal' };
const wait = { type:'wait' }, use = id => ({ type:'move',moveId:id });
const base = (o={}) => ({ character_id:'test',name:'Test',hp:200,phy_atk:120,phy_def:100,sp_atk:160,sp_def:100,speed:120,regen_value:0,energy_charge:0,element_1:'none',element_2:null,skillIds:['attack'],...o });
function make({moves=[strike],player,enemy,random=()=>.99,...other}={}) {
  return go.createBattle({effects,battleEffects:defenses,passives,powerRules,skills:new Map(moves.map(m=>[m.skill_id,m])),effectiveness:chart,
    player:player??[base({skillIds:moves.map(m=>m.skill_id)})],enemy:enemy??[base({character_id:'target',name:'Target',hp:2000})],random,...other});
}
const active = (b,s='player') => go.activeFighter(b,s);
const attach = (fighter,id,turns=effects.get(id).turn,patch={}) => fighter.statuses.push({definition:{...effects.get(id),...patch},turns});
const round = b => go.resolveTurn(b,{player:wait,enemy:wait});
const statusMove = id => ({ ...strike,skill_id:'give-'+id,name:id,category:'status',power:0,cost:0,effect1:id,effect_target1:'enemy',effect_chance1:100 });



vm.runInContext(read('go-ui.js'),ctx);const ui=get('geneOrderUI'),gp=get('geneOrderPassives');
const wing=skills.get('skill_066');
function passive(specs,id){const row={passive_id:id,name:id};specs.forEach(([type,target,value],i)=>Object.assign(row,{['passive_type'+(i+1)]:type,['target_id'+(i+1)]:target,['value'+(i+1)]:String(value)}));const p=gp.normalize(row,elements,statusIds,types);assert.deepEqual([...p.issues],[]);return p;}
function battle({move=wing,own=[],foe=[],playerBase={},enemyBase={},...rest}={}){return make({moves:[move],player:[base({passive_id:'own',energy_charge:0,skillIds:[move.skill_id],...playerBase})],enemy:[base({character_id:'foe',hp:2000,speed:10,passive_id:'foe',element_1:'earth',...enemyBase})],passives:new Map([['own',passive(own,'own')],['foe',passive(foe,'foe')]]),...rest});}
const cast=(b)=>{active(b).energy=7;return go.resolveTurn(b,{player:use([...b.skills.keys()][0]),enemy:wait});};
const preview=b=>go.previewDamage(b,'player',[...b.skills.values()][0]);
for(const [a,b,want]of [[0,0,0],[0,.5,.5],[0,1,1],[0,2,2],[.5,.5,.25],[.5,1,.5],[.5,2,1],[1,1,1],[1,2,2],[2,2,4]])test('nonzero multiplication '+a+' and '+b+' yields '+want,()=>{const fake=new Map([['light',new Map([['earth',a]])],['wind',new Map([['earth',b]])]]);assert.equal(go.moveWeaknessMultiplier({element_1:'earth'},wing,fake),want);});
const ids=rows('element').map(r=>r.element_id);
for(const first of ids)for(const second of ids)test('formal chart ordered attack '+first+'/'+second+' against all single/dual defenders',()=>{const move={...wing,element:first,element2:second};for(const d1 of ids)for(const d2 of [null,...ids]){const target={element_1:d1,element_2:d2},types=[...new Set([first,...(second==='none'?[]:[second])])],factors=types.map(a=>[...new Set([d1,d2].filter(x=>x!=null))].reduce((n,d)=>n*chart.get(a).get(d),1)),nonzero=factors.filter(n=>n!==0),want=nonzero.length?nonzero.reduce((a,b)=>a*b,1):0;assert.equal(go.moveWeaknessMultiplier(target,move,chart),want);}});
test('corrected required real-CSV examples: light/wind earth 2; fire/water earth 4; dual halves .25',()=>{assert.equal(go.moveWeaknessMultiplier({element_1:'earth'},wing,chart),2);assert.equal(go.moveWeaknessMultiplier({element_1:'earth'},{...wing,element:'fire',element2:'water'},chart),4);assert.equal(go.moveWeaknessMultiplier({element_1:'fire'},{...wing,element:'fire',element2:'ice'},chart),.25);});
for(const element of ids)test('all existing single '+element+' matchups remain unchanged',()=>{for(const def of ids)for(const second of [null,undefined,'','none',element])assert.equal(go.moveWeaknessMultiplier({element_1:def},{...wing,element,element2:second},chart),chart.get(element).get(def));});
for(const own of ['light','wind','earth'])test('STAB recognizes either attribute once for '+own,()=>{const b=battle({playerBase:{element_1:own,element_2:own==='light'?'wind':null}});assert.equal(preview(b).stab,own==='earth'?1:1.25);});
test('duplicate attributes do not duplicate STAB, power, incoming or stage hooks',()=>{const move={...wing,element:'wind',element2:'wind'},b=battle({move,own:[['element_power_multiplier','wind',1.2],['on_use_element_stat_stage','wind_pa',1]],foe:[['element_damage_multiplier','wind',.5],['on_hit_element_stat_stage','wind_pd',1]],playerBase:{element_1:'wind'}});const p=preview(b);assert.equal(p.power,60);assert.equal(p.stab,1.25);assert.equal(p.damagePassives.length,1);const e=cast(b).events;assert.equal(active(b).stages.phy_atk,1);assert.equal(active(b,'enemy').stages.phy_def,1);assert.equal(e.filter(e=>e.phase==='after-use').length,1);});
for(const element of ['light','wind'])test('matching either attribute immunity blocks the whole attack independently of chart zeros: '+element,()=>{const b=battle({foe:[['element_immunity',element,1]]});assert.equal(preview(b).reason,'passive-immune');assert.equal(preview(b).actualDamage,0);assert.equal(cast(b).events.filter(e=>e.type==='move')[0].actualDamage,0);});
test('both distinct passive slots apply once with existing multiplier order and stage bounds',()=>{const b=battle({own:[['element_power_multiplier','light',1.2],['element_power_multiplier','wind',2],['on_use_element_stat_stage','wind_sp',1]],foe:[['element_damage_multiplier','light',.5],['element_damage_multiplier','wind',.5],['on_hit_element_stat_stage','wind_pa',1]]});const p=preview(b);assert.equal(p.power,120);assert.equal(p.damagePassives.length,2);assert.equal(p.damage,Math.max(1,go.roundHalfDown(p.afterEffectiveness*.25)));const e=cast(b).events;assert.equal(active(b).stages.speed,1);assert.equal(active(b,'enemy').stages.phy_atk,1);assert.equal(e.filter(e=>e.phase==='body-hit').length,1);});
test('formal wing is available and preview, AI, UI matchup, log and real damage agree',()=>{let randomCalls=0;const b=battle({random:()=>{randomCalls++;return .99;}});active(b).energy=7;assert.equal(go.unsupportedMoveReason(wing,b),'');assert.equal(go.checkAction(b,'player',use(wing.skill_id)),'');const before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),p=preview(b);const candidates=ai.evaluate(ai.observe(b,'player'));assert.ok(candidates.some(c=>c.action.moveId===wing.skill_id));assert.equal(ui.moveMatchup(wing,active(b,'enemy'),{effectiveness:chart,battleEffects:defenses}).multiplier,p.effectiveness);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(randomCalls,0);const e=cast(b).events.find(e=>e.type==='move');assert.equal(e.actualDamage,p.actualDamage);assert.equal(e.effectiveness,2);assert.deepEqual([...e.elements],['light','wind']);assert.match(get('describeGeneOrderEvent')(e),/light・wind/);});
test('dual attack additional effect executes once',()=>{const b=battle({move:{...wing,effect1:'bf_pd_down1',effect_target1:'enemy',effect_chance1:100}});const e=cast(b).events;assert.equal(active(b,'enemy').stages.phy_def,-1);assert.equal(e.filter(e=>e.type==='stage').length,1);});
test('invalid second IDs and missing matchups throw rather than become neutral',()=>{for(const patch of [{element:'unknown'},{element2:'unknown'}]){const b=battle({move:{...wing,...patch}});assert.throws(()=>preview(b),/未定義/);assert.match(go.unsupportedMoveReason([...b.skills.values()][0],b),/属性/);}const missing=new Map([...chart].map(([id,row])=>[id,new Map(row)]));missing.get('wind').delete('earth');assert.throws(()=>go.moveWeaknessMultiplier({element_1:'earth'},wing,missing),/未定義/);const raw=rows('skill').find(r=>r.skill_id==='skill_066');assert.equal(get('normalizeSkill')({...raw,element2:'bad'},elements).element2,'bad');});
test('secondary-attribute guard applies once and preserves final rounding',()=>{const b=battle(),f=active(b,'enemy');assert.equal(go.guardApplies({guard_type:'wind_damage'},wing),true);const plain=preview(b),def={battle_effect_id:'fixture',name:'壁',battle_effect_group:'guard',guard_type:'wind_damage',damage_cut:50,turn:3};b.fields.enemy.set('fixture',{definition:def,starts:1,expires:4});const p=preview(b);assert.equal(p.damage,Math.max(1,go.roundHalfDown(plain.afterEffectiveness*.5)));});
test('next-use boosts on both attributes are predicted without consumption then consumed once each',()=>{const b=battle(),f=active(b);for(const [element,modifier]of [['light',1.2],['wind',1.5]])f.nextElementPower.set(element,{element,modifier,battle_effect_id:'fixture_'+element});const p=preview(b);assert.equal(p.power,90);assert.equal(f.nextElementPower.size,2);const e=cast(b).events;assert.equal(e.filter(e=>e.type==='next-power-used').length,2);assert.equal(f.nextElementPower.size,0);assert.equal(e.find(e=>e.type==='move').power,90);});
test('charged dual attack freezes both boosts once and release uses frozen power',()=>{const source=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='charge')),move={...source,element:'light',element2:'wind',cost:0},b=battle({move}),f=active(b);f.nextElementPower.set('wind',{element:'wind',modifier:1.5,battle_effect_id:'fixture'});cast(b);assert.ok(f.pending);const power=f.pending.power;assert.equal(f.nextElementPower.size,0);const p=preview(b),e=cast(b).events;assert.equal(p.power,power);assert.equal(e.find(e=>e.type==='move').power,power);assert.equal(e.filter(e=>e.type==='next-power-used').length,0);});
