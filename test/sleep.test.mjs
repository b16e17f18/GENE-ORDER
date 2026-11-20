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


const nap = { ...strike,skill_id:'fixture_sleep',name:'眠り検証',category:'status',power:0,cost:0,priority:5,effect1:'sleep',effect_target1:'enemy',effect_chance1:100 };
const hit = { ...strike,cost:0 };
const hasSleep = f => f.statuses.some(({definition})=>definition.effect_id==='sleep');
const cast = (b,player,enemy=wait)=>go.resolveTurn(b,{player,enemy});
test('sleep CSV preserves inherited MHB control definition and sets data-driven 100-percent failure',()=>{
 const legacy=get('rowsFromCsv')(read('MBHdata/effect.csv')).find(e=>e.effect_id==='sleep');const current=rows('effect').find(e=>e.effect_id==='sleep');
 for(const field of ['effect_id','name','effect_group','damage_type','damage_value','turn','can_move','target_stat','start_text'])assert.equal(current[field],legacy[field],field);
 assert.equal(current.action_failure_chance,'100');assert.equal(effects.get('sleep').can_move,false);assert.equal(go.effectKind(effects.get('sleep')),'status');assert.ok(statusIds.has('sleep'));
});
test('sleep blocks three turns, costs no EN or HP and restores action on the fourth',()=>{
 let rolls=0;const b=make({random:()=>{rolls++;return .99;}}),f=active(b);f.energy=7;attach(f,'sleep');
 for(let i=0;i<3;i++){const e=cast(b,use('attack')).events;assert.equal(e.filter(e=>e.type==='action-failed').length,1);assert.equal(e.some(e=>e.type==='move'),false);assert.equal(f.energy,7);assert.equal(f.hp,200);assert.equal(active(b,'enemy').hp,2000);}
 assert.equal(rolls,0);assert.equal(hasSleep(f),false);assert.equal(go.actionFailureChance(f),0);const e=cast(b,use('attack')).events;assert.ok(e.some(e=>e.type==='move'));assert.equal(f.energy,5);
});
test('CSV sleep application stops the slower selected move in the same turn',()=>{
 const b=make({moves:[nap,strike],enemy:[base({hp:2000,speed:10,skillIds:['attack']})]});active(b,'enemy').energy=7;const e=cast(b,use(nap.skill_id),use('attack')).events;assert.ok(e.some(e=>e.type==='status-applied'&&e.effect==='sleep'));assert.ok(e.some(e=>e.type==='action-failed'&&e.side==='enemy'));assert.equal(active(b,'enemy').energy,7);assert.equal(active(b).hp,200);
});
for(const type of ['physical','special'])test(type+' body damage wakes a slower foe before its turn',()=>{
 const m={...hit,attack_type:type},b=make({moves:[m],enemy:[base({hp:2000,speed:10,skillIds:['attack']})]});const f=active(b,'enemy');f.energy=7;attach(f,'sleep');
 const forecast=go.previewDamage(b,'player',m);assert.equal(forecast.wakesTarget,true);assert.equal(forecast.targetActionFailureChanceAfterDamage,0);
 const e=cast(b,use('attack'),use('attack')).events;assert.equal(e.filter(e=>e.type==='awakened').length,1);assert.equal(hasSleep(f),false);assert.equal(e.some(e=>e.type==='action-failed'),false);assert.ok(e.some(e=>e.type==='move'&&e.side==='enemy'));assert.equal(f.hp,2000-forecast.actualDamage);
});
test('waking after a faster sleeper already failed does not grant an extra action',()=>{
 const b=make({moves:[hit],enemy:[base({hp:2000,speed:1000,skillIds:['attack']})]});attach(active(b,'enemy'),'sleep');const e=cast(b,use('attack'),use('attack')).events;
 assert.equal(e.filter(e=>e.type==='action-failed'&&e.side==='enemy').length,1);assert.equal(e.filter(e=>e.type==='move'&&e.side==='enemy').length,0);assert.ok(e.findIndex(e=>e.type==='action-failed')<e.findIndex(e=>e.type==='awakened'));
});
test('attack secondary sleep is applied after waking and can stop the later action again',()=>{
 const m={...hit,effect1:'sleep',effect_target1:'enemy',effect_chance1:100},b=make({moves:[m],enemy:[base({hp:2000,speed:10,skillIds:['attack']})]});const f=active(b,'enemy');attach(f,'sleep');const e=cast(b,use('attack'),use('attack')).events;
 assert.ok(e.findIndex(e=>e.type==='awakened')<e.findIndex(e=>e.type==='status-applied'));assert.ok(e.some(e=>e.type==='action-failed'&&e.side==='enemy'));assert.equal(f.statuses.filter(s=>s.definition.effect_id==='sleep').length,1);assert.equal(f.statuses[0].turns,2);
});
for(const protection of ['dodge','element-immune','passive-immune','decoy','broken-decoy','reflection'])test(protection+' prevents body damage and does not wake sleep',()=>{
 const m={...hit,element:protection==='element-immune'?'earth':protection==='passive-immune'?'water':'none'};
 const b=make({moves:[m],enemy:[base({hp:2000,element_1:protection==='element-immune'?'wind':'none',passive_id:protection==='passive-immune'?'passive_002':null})]});const f=active(b,'enemy');attach(f,'sleep');
 if(protection==='dodge')f.dodgeActive=true;if(protection.includes('decoy'))f.decoy={hp:protection==='broken-decoy'?1:1000,maxHp:1000};
 if(protection==='reflection'){const def=[...defenses.values()].find(d=>go.battleEffectKind(d)==='reflection');assert.ok(def);f.defenses.set(def.battle_effect_id,{definition:def,id:def.battle_effect_id,starts:b.turn,expires:b.turn+1});m.attack_type='special';}
 const before=f.hp,forecast=go.previewDamage(b,'player',m);assert.equal(forecast.wakesTarget,false);const e=cast(b,use('attack')).events;assert.equal(f.hp,before);assert.equal(hasSleep(f),true);assert.equal(e.some(e=>e.type==='awakened'),false);
});
test('residual poison and burn damage do not wake sleep',()=>{
 const b=make(),f=active(b);attach(f,'sleep');attach(f,'poison');attach(f,'burn');const e=round(b).events;assert.ok(f.hp<200);assert.equal(hasSleep(f),true);assert.equal(e.some(e=>e.type==='awakened'),false);assert.equal(f.statuses.find(s=>s.definition.effect_id==='sleep').turns,2);
});
test('wake removes only sleep and leaves paralysis failure and burn stat multiplier intact',()=>{
 const b=make({moves:[hit]}),f=active(b,'enemy');for(const id of ['sleep','paralysis','burn'])attach(f,id);const before=go.statValue(f,'phy_atk');const p=go.previewDamage(b,'player',hit);assert.equal(p.targetActionFailureChanceAfterDamage,25);cast(b,use('attack'));assert.equal(hasSleep(f),false);assert.equal(go.actionFailureChance(f),25);assert.equal(go.statValue(f,'phy_atk'),before);assert.equal(f.statuses.length,2);
});
test('lethal body hit clears sleep without a false awake notification',()=>{
 const m={...hit,power:100000},b=make({moves:[m]}),f=active(b,'enemy');attach(f,'sleep');const e=cast(b,use('attack')).events;assert.equal(f.hp,0);assert.equal(f.fainted,true);assert.equal(hasSleep(f),false);assert.equal(e.some(e=>e.type==='awakened'),false);
});
test('repeat sleep refreshes one entry without stacking and uses the MHB maximum duration',()=>{
 const b=make({moves:[nap]}),f=active(b,'enemy');attach(f,'sleep',1);cast(b,use(nap.skill_id));assert.equal(f.statuses.length,1);assert.equal(f.statuses[0].turns,2);f.statuses[0].turns=5;cast(b,use(nap.skill_id));assert.equal(f.statuses.length,1);assert.equal(f.statuses[0].turns,4);
});
test('normal switching remains possible, preserves sleep and pauses its timer on the bench',()=>{
 let rolls=0;const b=make({player:[base(),base({character_id:'bench'})],enemy:[base({hp:2000,speed:20})],random:()=>{rolls++;return .99;}}),f=active(b);attach(f,'sleep');assert.equal(go.checkAction(b,'player',{type:'switch',index:1}),'');cast(b,{type:'switch',index:1});round(b);assert.equal(f.statuses[0].turns,3);cast(b,{type:'switch',index:0});assert.equal(f.statuses[0].turns,2);assert.equal(rolls,0);
});
test('sleep allows ordinary end-turn HP and EN recovery while disabling all skill categories and common dodge',()=>{
 const b=make({moves:[strike,nap,skills.get('skill_000')],player:[base({regen_value:5,energy_charge:2,skillIds:['attack',nap.skill_id,'skill_000']})]}),f=active(b);attach(f,'sleep');f.hp=100;f.energy=2;
 for(const id of ['attack',nap.skill_id,'skill_000']){const e=cast(b,use(id)).events;assert.ok(e.some(e=>e.type==='action-failed'));assert.equal(e.some(e=>e.type==='dodge-attempt'),false);assert.equal(e.some(e=>e.type==='move'),false);}
 assert.equal(f.hp,115);assert.equal(f.energy,7);assert.equal(hasSleep(f),false);
});
test('sleep before charged release preserves its reservation and does not repay EN',()=>{
 const m=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='charge'));assert.ok(m);
 const b=make({moves:[m]}),f=active(b);f.energy=7;cast(b,use(m.skill_id));const pending=JSON.stringify(f.pending),en=f.energy;attach(f,'sleep',1);const failed=cast(b,use(m.skill_id)).events;assert.ok(failed.some(e=>e.type==='action-failed'));assert.equal(JSON.stringify(f.pending),pending);assert.equal(f.energy,en);const released=cast(b,use(m.skill_id)).events;assert.equal(released.find(e=>e.type==='move').cost,0);assert.equal(f.pending,null);
});
test('sleep prevents special switching and HP costs before a switch request is yielded',()=>{
 const m=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='tail-purge'));assert.ok(m);
 const b=make({moves:[m],player:[base(),base({character_id:'bench'})],manualSwitches:true}),f=active(b);f.base={...f.base,skillIds:[m.skill_id]};f.energy=7;attach(f,'sleep');const e=cast(b,use(m.skill_id));assert.equal(e.pendingSwitch,null);assert.equal(b.active.player,0);assert.equal(f.hp,200);assert.equal(f.energy,7);assert.ok(e.events.some(e=>e.type==='action-failed'));
});
test('sleep amount and duration reload from CSV without a new effect handler',()=>{
 const source=read('data/effect.csv');const modified=source.replace('sleep,睡眠,control,none,0,3,','sleep,睡眠,control,none,0,2,');const loaded=new Map(get('rowsFromCsv')(modified).map(r=>[r.effect_id,get('normalizeEffect')(r)]));const b=make({moves:[nap],effects:loaded});cast(b,use(nap.skill_id));assert.equal(active(b,'enemy').statuses[0].turns,1);round(b);assert.equal(hasSleep(active(b,'enemy')),false);
});
test('preview and AI include sleep and wake forecasts without mutation or battle RNG consumption',()=>{
 let rolls=0;const b=make({moves:[hit,nap],random:()=>{rolls++;return .99;}});active(b).energy=7;const f=active(b,'enemy');attach(f,'sleep');const before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);const preview=go.previewDamage(b,'player',hit),candidates=ai.evaluate(ai.observe(b,'player'));assert.equal(preview.wakesTarget,true);assert.equal(candidates.find(c=>c.action.moveId==='attack').forecast.wakesTarget,true);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(rolls,0);
 attach(active(b),'sleep');const asleep=go.previewDamage(b,'player',hit);assert.equal(asleep.executionChance,0);assert.equal(asleep.expectedDamage,0);assert.equal(asleep.actionFailureChance,100);
});
test('MHB and GO agree on control and direct attack wake logs',()=>{
 const legacy={name:'Gene',hp:10,statuses:[{id:'sleep',turns:3}]};assert.match(get('blockedByControl')(legacy),/眠っている/);const e=get('clearSleepOnAttackDamage')(legacy);assert.equal(legacy.statuses.length,0);assert.equal(e[0].text,get('describeGeneOrderEvent')({type:'awakened',actor:'Gene'}));
});
