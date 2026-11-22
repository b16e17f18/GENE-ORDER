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



const wing=skills.get('skill_066');
function battle(id='passive_029',options={}){return make({moves:[{...strike,cost:0}],player:[base({element_1:'fire',skillIds:['attack']})],enemy:[base({hp:200,speed:10,element_1:'earth',passive_id:id})],...options});}
const damage=b=>go.previewDamage(b,'player',b.skills.get('attack'));
const without=b=>({...b,teams:{...b.teams,enemy:[{...go.activeFighter(b,'enemy'),passiveEffects:[]}]}});
for(const id of ['passive_026','passive_029'])test('formal '+id+' uses valid conditional damage handler without changing values',()=>{const p=passives.get(id);assert.equal(p.status,'implemented');assert.deepEqual([...p.issues],[]);const effect=p.effects.find(e=>e.handler==='conditional_damage_multiplier');assert.equal(effect.value,id==='passive_026'?.5:.75);assert.equal(effect.condition.operator,'eq');});
for(const hp of [200,199,100])test('formal full-HP .75 shield at HP '+hp,()=>{const b=battle(),f=active(b,'enemy');f.hp=hp;const expected=damage(without(b)),p=damage(b);assert.equal(p.damage,hp===200?Math.max(1,go.roundHalfDown(expected.afterEffectiveness*.75)):expected.damage);assert.equal(p.damagePassives.length,hp===200?1:0);});
for(const hp of [102,100,98,200])test('formal low-HP SP2 and recovery automatically restore speed at '+hp,()=>{const b=battle(),f=active(b,'enemy');f.hp=hp;assert.equal(go.effectiveSpeed(b,'enemy'),hp<=100?20:10);assert.equal(f.stages.speed,0);f.hp=200;assert.equal(go.effectiveSpeed(b,'enemy'),10);});
test('formal shield returns after an actual heal and leaves after the next body hit',()=>{const b=battle(),f=active(b,'enemy'),heal={...strike,skill_id:'fixture_heal',name:'検証回復',category:'status',power:0,cost:0,priority:5,effect1:'bf_heal_half',effect_target1:'self',effect_chance1:100};b.skills.set(heal.skill_id,heal);f.base={...f.base,skillIds:[heal.skill_id]};f.hp=150;assert.equal(damage(b).damagePassives.length,0);let r=go.resolveTurn(b,{player:wait,enemy:use(heal.skill_id)});assert.ok(r.events.some(e=>e.type==='heal'&&e.recovered===50));assert.equal(f.hp,200);assert.equal(damage(b).damagePassives.length,1);const expected=damage(b).damage;r=go.resolveTurn(b,{player:use('attack'),enemy:wait});assert.equal(r.events.find(e=>e.type==='move').actualDamage,expected);assert.equal(damage(b).damagePassives.length,0);});
test('old invalid all targets still diagnose errors rather than silently behave as HP reduction',()=>{for(const [type,target]of [['conditional_stat_multiplier','all'],['element_damage_multiplier','all']]){const p=get('geneOrderPassives.normalize')({name:'不正検証',passive_type1:type,target_id1:target,value1:'.5',condition1:'self_hp_eq:1/1'},elements,statusIds,types);assert.ok(p.issues.some(e=>e.field==='target_id1'));}});
test('HP-conditional forecasts and AI do not mutate battle state or use RNG',()=>{let rolls=0;const b=battle('passive_029',{random:()=>{rolls++;return .99;}}),before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);damage(b);ai.evaluate(ai.observe(b,'player'));assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(rolls,0);});
