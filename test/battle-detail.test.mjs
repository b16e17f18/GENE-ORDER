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


vm.runInContext(read('go-ui.js'),ctx);const ui=get('geneOrderUI');
for(let stage=-6;stage<=6;stage++)test('six stage markers for '+stage,()=>{const n=Math.abs(stage);assert.equal(ui.stageMarks(stage),(stage>0?'▲':'▼').repeat(n)+'・'.repeat(6-n));assert.equal([...ui.stageMarks(stage)].length,6);});
test('battle grade tracks current effective numbers rather than base grade',()=>{
 const f=active(make());f.base={...f.base,phy_atk:81};assert.match(ui.battleStatMarkup('phy_atk',go.statValue(f,'phy_atk'),0),/>D<\/span>/);f.stages.phy_atk=2;const up=ui.battleStatMarkup('phy_atk',go.statValue(f,'phy_atk'),2);assert.match(up,/>S<\/span>/);assert.match(up,/▲▲・・・・/);assert.match(up,/>162<\/strong>/);attach(f,'burn');assert.match(ui.battleStatMarkup('phy_atk',go.statValue(f,'phy_atk'),2),/>D<\/span>/);
});
test('hidden opponent row omits numeric values in text, titles and attributes, while retaining grade and markers',()=>{
 const html=ui.battleStatMarkup('phy_atk',162,2,true);assert.doesNotMatch(html,/162|detail-stat-value|title=/);assert.match(html,/>S<\/span>/);assert.match(html,/▲▲・・・・/);assert.doesNotMatch(html,/detail-stat-track|detail-stat-fill/);
});
test('unranked recovery has no grade or stage markers, player sees its value',()=>{const html=ui.battleStatMarkup('regen_value',22);assert.match(html,/>22<\/strong>/);assert.doesNotMatch(html,/▲|▼|・|stat-rank-color|detail-stat-track/);});
test('battle rendering leaves data, stages and rank definitions untouched',()=>{const b=make(),before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),ranks=get('GO_STAT_RANKS');const rankBefore=JSON.stringify(ranks);for(const stat of ['phy_atk','phy_def','sp_atk','sp_def','speed'])ui.battleStatMarkup(stat,go.statValue(active(b),stat),0);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(JSON.stringify(ranks),rankBefore);assert.match(get('goCharacterStat')('phy_atk',81),/detail-stat-track/);});
