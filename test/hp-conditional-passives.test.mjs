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


const gp=get('geneOrderPassives');
function passive(specs,id){const row={passive_id:id,name:id,text:'検証用'};specs.forEach(([type,target,value,condition],i)=>Object.assign(row,{['passive_type'+(i+1)]:type,['target_id'+(i+1)]:target,['value'+(i+1)]:String(value),['condition'+(i+1)]:condition??''}));const p=gp.normalize(row,elements,statusIds,types);assert.deepEqual([...p.issues],[]);return p;}
const shield=['conditional_damage_multiplier','all',.5,'self_hp_eq:1/1'];
const lowSA=['conditional_stat_multiplier','sa',1.5,'self_hp_lte:1/2'];
const hit={...strike,cost:0,power:40,element:'none'};
function battle({own=[],foe=[shield],move=hit,enemyBase={},playerBase={}}={}){return make({moves:[move],player:[base({passive_id:'own',skillIds:[move.skill_id],...playerBase})],enemy:[base({hp:100,speed:10,passive_id:'foe',...enemyBase})],passives:new Map([['own',passive(own,'own')],['foe',passive(foe,'foe')]])});}
const cast=b=>go.resolveTurn(b,{player:use('attack'),enemy:wait});
const calc=b=>go.previewDamage(b,'player',b.skills.get('attack'));
function noShield(b){const f=active(b,'enemy');return {...b,teams:{...b.teams,enemy:[{...f,passiveEffects:[]}]}};}
test('HP-conditioned damage type remains registered in the expanded catalog',()=>{assert.equal(types.types.size,38);assert.deepEqual([...types.issues],[]);assert.equal(types.types.get('conditional_damage_multiplier').condition_kind,'stat_condition');});
for(const category of ['physical','special'])for(const percent of [100,99,50])test(category+' conditional damage at HP '+percent+' percent',()=>{
 const b=battle({move:{...hit,attack_type:category}}),f=active(b,'enemy');f.hp=percent;const normal=calc(noShield(b)),result=calc(b);const expected=percent===100?Math.max(1,go.roundHalfDown(normal.afterEffectiveness*.5)):normal.damage;assert.equal(result.damage,expected);assert.equal(result.damagePassives.length,percent===100?1:0);const e=cast(b).events;assert.equal(e.find(e=>e.type==='move').actualDamage,Math.min(percent,expected));
});
for(const element of ['fire','water','thunder','ice','wind','earth','light','dark','none'])test('full-HP reduction is independent of attack element '+element,()=>{const b=battle({move:{...hit,element}}),p=calc(b),plain=calc(noShield(b));assert.equal(p.damage,Math.max(1,go.roundHalfDown(plain.afterEffectiveness*.5)));});
for(const category of ['physical','special'])test(category+' stacks with STAB, chart, guard, wall and elemental passive before one final rounding',()=>{
 const move={...hit,element:'fire',attack_type:category},b=battle({move,foe:[shield,['element_damage_multiplier','fire',.5]],playerBase:{element_1:'fire'},enemyBase:{element_1:'earth'}}),f=active(b,'enemy');f.halfGuard=50;
 const wall={battle_effect_id:'fixture_wall',name:'検証壁',battle_effect_group:'guard',guard_type:category==='physical'?'phy_damage':'sp_damage',damage_cut:50,turn:3};b.fields.enemy.set(wall.battle_effect_id,{id:wall.battle_effect_id,definition:wall,starts:1,expires:4});const p=calc(b);assert.equal(p.effectiveness,2);assert.equal(p.stab,calc(noShield(b)).stab);assert.equal(p.damage,Math.max(1,go.roundHalfDown(p.afterEffectiveness*.5*.5*.5*.5)));assert.equal(p.damagePassives.length,2);assert.equal(cast(b).events.find(e=>e.type==='move').damage,p.damage);
});
test('full-HP reduction vanishes after first hit and returns after a real healing move',()=>{
 const b=battle(),f=active(b,'enemy'),first=calc(b).damage;assert.ok(first>0);cast(b);const ordinary=calc(b).damage;assert.ok(ordinary>first);cast(b);
 const heal={...hit,skill_id:'fixture_heal',name:'検証回復',category:'status',power:0,effect1:'bf_heal_half',effect_target1:'self',effect_chance1:100};b.skills.set(heal.skill_id,heal);f.base={...f.base,skillIds:[heal.skill_id]};go.resolveTurn(b,{player:wait,enemy:use(heal.skill_id)});assert.equal(f.hp,f.maxHp);assert.equal(calc(b).damage,first);assert.equal(cast(b).events.find(e=>e.type==='move').damage,first);
});
test('one HP lost disables exact-full condition even at an odd maximum',()=>{const b=battle({enemyBase:{hp:203}}),f=active(b,'enemy');assert.equal(calc(b).damagePassives.length,1);f.hp=202;assert.equal(calc(b).damagePassives.length,0);});
test('immunity stays zero and minimum positive damage keeps existing rounding rules',()=>{
 const immune=battle({move:{...hit,element:'earth'},enemyBase:{element_1:'wind'}});assert.equal(calc(immune).damage,0);
 const tiny=battle({move:{...hit,power:1},enemyBase:{phy_def:10000}}),f=active(tiny,'enemy');f.halfGuard=99;assert.equal(calc(tiny).damage,1);
});
for(const hp of [102,100,98,200])test('SA threshold at '+hp+'/200 is inclusive and dynamically reversible',()=>{const b=battle({own:[lowSA],foe:[]}),f=active(b);f.hp=hp;assert.equal(go.statValue(f,'sp_atk'),hp<=100?240:160);assert.equal(f.stages.sp_atk,0);assert.equal(f.base.sp_atk,160);f.hp=200;assert.equal(go.statValue(f,'sp_atk'),160);});
for(const stage of [-3,-1,0,1,3])test('SA HP multiplier is independent of stage '+stage,()=>{const b=battle({own:[lowSA],foe:[]}),f=active(b);f.hp=100;f.stages.sp_atk=stage;const raw=stage>=0?160*(2+stage)/2:160*2/(2-stage);assert.equal(go.statValue(f,'sp_atk'),Math.floor(raw*1.5));assert.equal(f.stages.sp_atk,stage);f.hp=200;assert.equal(go.statValue(f,'sp_atk'),Math.floor(raw));assert.equal(f.stages.sp_atk,stage);});
test('odd maximum uses exact integer ratio comparison without rounding the 50-percent threshold',()=>{const b=battle({own:[lowSA],foe:[],playerBase:{hp:201}}),f=active(b);f.hp=101;assert.equal(go.statValue(f,'sp_atk'),160);f.hp=100;assert.equal(go.statValue(f,'sp_atk'),240);});
test('HP expense crossing the SA threshold is shared by preview and actual execution',()=>{
 const move={...hit,attack_type:'special',priority:1},b=battle({move,own:[lowSA,['priority_move_hp_cost','hp',-.1,'1']],foe:[]}),f=active(b);f.hp=101;assert.equal(go.statValue(f,'sp_atk'),160);const p=calc(b);assert.equal(p.attack,240);assert.equal(p.hpCost,20);const events=cast(b).events;assert.equal(f.hp,81);assert.equal(events.find(e=>e.type==='move').damage,p.damage);assert.equal(go.statValue(f,'sp_atk'),240);
});
test('both examples coexist in separate slots without modifying base stats or stage state',()=>{
 const b=battle({own:[shield,lowSA],foe:[]}),f=active(b),attack=b.skills.get('attack'),target=active(b,'enemy');assert.equal(gp.damageModifiers(f,attack,target).length,1);assert.equal(go.statValue(f,'sp_atk'),160);f.hp=100;assert.equal(gp.damageModifiers(f,attack,target).length,0);assert.equal(go.statValue(f,'sp_atk'),240);f.hp=200;assert.equal(gp.damageModifiers(f,attack,target).length,1);assert.equal(go.statValue(f,'sp_atk'),160);
});
test('existing status and opponent-HP stat conditions preserve their comparisons',()=>{const b=battle({own:[['conditional_stat_multiplier','sa',1.5,'opponent_hp_lte:1/3']],foe:[],enemyBase:{hp:300}}),f=active(b),t=active(b,'enemy');t.hp=101;assert.equal(go.statValue(f,'sp_atk',{opponent:t}),160);t.hp=100;assert.equal(go.statValue(f,'sp_atk',{opponent:t}),240);});
test('invalid HP conditions and nonpositive multipliers are diagnosed without modifying CSV',()=>{
 for(const condition of ['self_hp_eq:2/1','self_hp_eq:1/0','self_hp_eq:1','self_hp_eq:50%','self_hp_gt:1/2','self_hp_lte:-1/2']){const p=gp.normalize({name:'Bad',passive_type1:'conditional_damage_multiplier',target_id1:'all',value1:'.5',condition1:condition},elements,statusIds,types);assert.ok(p.issues.some(i=>i.field==='condition1'),condition);}
 for(const value of ['0','-0.5','NaN'])assert.ok(gp.normalize({name:'Bad',passive_type1:'conditional_damage_multiplier',target_id1:'all',value1:value,condition1:'self_hp_eq:1/1'},elements,statusIds,types).issues.some(i=>i.field==='value1'));
});
test('a changed CSV fraction/multiplier reaches a fresh battle without another handler',()=>{
 const row=get('rowsFromCsv')('passive_id,name,passive_type1,target_id1,value1,condition1\nfixture,検証,conditional_damage_multiplier,all,0.25,self_hp_eq:1/1\n')[0];const p=gp.normalize(row,elements,statusIds,types);assert.deepEqual([...p.issues],[]);const b=battle();active(b,'enemy').passiveEffects=p.effects;const result=calc(b);assert.equal(result.damage,Math.max(1,go.roundHalfDown(result.afterEffectiveness*.25)));
});
test('preview and AI share current HP conditions without state mutation or RNG consumption',()=>{
 let rolls=0;const b=battle({own:[lowSA],move:{...hit,attack_type:'special'}});b.random=()=>{rolls++;return .1;};active(b).hp=100;const before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),p=calc(b),score=ai.evaluate(ai.observe(b,'player')).find(c=>c.action.moveId==='attack');assert.equal(score.damage,p.actualDamage);assert.equal(score.forecast.actorHp,p.actorHp);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(rolls,0);
});

test('a faster heal restores the full-HP shield before an incoming attack in the same turn',()=>{
 const b=battle(),f=active(b,'enemy');f.hp=90;const before=calc(b);assert.equal(before.damagePassives.length,0);const heal={...hit,skill_id:'fixture_heal',name:'検証回復',category:'status',power:0,priority:5,effect1:'bf_heal_half',effect_target1:'self',effect_chance1:100};b.skills.set(heal.skill_id,heal);f.base={...f.base,skillIds:[heal.skill_id]};const result=go.resolveTurn(b,{player:use('attack'),enemy:use(heal.skill_id)});assert.equal(result.events.find(e=>e.type==='move'&&e.side==='player').damage,go.roundHalfDown(before.afterEffectiveness*.5));assert.ok(result.events.findIndex(e=>e.type==='heal')<result.events.findIndex(e=>e.type==='move'&&e.side==='player'));
});
test('a faster HP cost disables the full-HP shield before an incoming attack in the same turn',()=>{
 const b=battle({foe:[shield,['priority_move_hp_cost','hp',-.01,'1']]}),f=active(b,'enemy'),normal=calc(noShield(b)).damage;const setup={...hit,skill_id:'fixture_setup',name:'検証強化',category:'status',power:0,priority:1,effect1:'bf_pa_up1',effect_target1:'self',effect_chance1:100};b.skills.set(setup.skill_id,setup);f.base={...f.base,skillIds:[setup.skill_id]};const result=go.resolveTurn(b,{player:use('attack'),enemy:use(setup.skill_id)});assert.equal(result.events.find(e=>e.type==='move'&&e.side==='player').damage,normal);assert.equal(f.hp,99-normal);
});
