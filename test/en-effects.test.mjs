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


const support = (id, overrides={}) => ({...strike,skill_id:'give-'+id,name:id,category:'status',power:0,cost:0,priority:1,effect1:id,effect_target1:'enemy',effect_chance1:100,...overrides});
const enact = (b,m,enemy=wait) => go.resolveTurn(b,{player:use(m.skill_id),enemy});
const add = (b,side,id) => { const definition=b.effects.get(id);active(b,side).timedEffects.set(id,{id,definition,starts:b.turn,expires:b.turn+definition.turn}); };
const cost = (b,side,m) => go.effectiveMoveCost(active(b,side),m,b.turn);
const charge = (b,side='enemy') => go.effectiveEnergyCharge(active(b,side),b.turn);
for(const [id,amount,start,end] of [['en_down1',1,3,2],['en_down2',2,3,1],['en_down2',2,1,0],['en_down1',1,0,0]])test(id+' respects lower EN bound from '+start,()=>{
  const m=support(id),b=make({moves:[m]});active(b,'enemy').energy=start;const events=enact(b,m).events;assert.equal(active(b,'enemy').energy,end);assert.equal(events.find(e=>e.type==='effect-energy').recovered,end-start);assert.equal(active(b,'enemy').hp,2000);assert.equal(active(b,'enemy').statuses.length,0);
});
for(const [enemyEN,userEN,lost,gained] of [[3,1,1,1],[0,1,0,0],[1,7,1,0]])test('EN drain actual amount/cap '+enemyEN+'/'+userEN,()=>{
  const m=support('en_drain1'),b=make({moves:[m]});active(b).energy=userEN;active(b,'enemy').energy=enemyEN;const events=enact(b,m).events,e=events.find(e=>e.type==='en-drain');assert.equal(e.lost,lost);assert.equal(e.recovered,gained);assert.equal(active(b).energy,userEN+gained);assert.equal(active(b,'enemy').energy,enemyEN-lost);
});
test('self drain cannot create EN and self/enemy targeting follows CSV slot',()=>{const m=support('en_drain1',{effect_target1:'self'}),b=make({moves:[m]});active(b).energy=4;enact(b,m);assert.equal(active(b).energy,4);assert.equal(active(b,'enemy').energy,1);});
for(const baseCharge of [0,1,2])test('natural EN charge reduction floor/base immutability '+baseCharge,()=>{
  const m=support('en_charge_down1'),b=make({moves:[m],enemy:[base({hp:2000,energy_charge:baseCharge})]});active(b,'enemy').energy=0;enact(b,m);assert.equal(active(b,'enemy').energy,Math.max(0,baseCharge-1));assert.equal(active(b,'enemy').base.energy_charge,baseCharge);assert.equal(active(b,'enemy').statuses.length,0);
});
test('three turns include all three natural recoveries, then normal charge resumes',()=>{
  const m=support('en_charge_zero'),b=make({moves:[m],enemy:[base({hp:2000,energy_charge:2})]});const f=active(b,'enemy');f.energy=0;
  enact(b,m);assert.equal(f.energy,0);assert.equal(f.timedEffects.size,1);round(b);assert.equal(f.energy,0);const e=round(b).events;assert.equal(f.energy,0);assert.equal(f.timedEffects.size,0);assert.equal(e.filter(e=>e.type==='effect-expired'&&e.name===effects.get('en_charge_zero').name).length,1);round(b);assert.equal(f.energy,2);
});
test('zero charge overrides reduction in either application order and effects coexist with poison',()=>{
  for(const order of [['en_charge_zero','en_charge_down1'],['en_charge_down1','en_charge_zero']]){const b=make({enemy:[base({hp:2000,energy_charge:2})]});for(const id of order)add(b,'enemy',id);attach(active(b,'enemy'),'poison');assert.equal(charge(b),0);assert.equal(active(b,'enemy').timedEffects.size,2);assert.equal(active(b,'enemy').statuses.length,1);}
});
test('direct skill EN recovery ignores natural charge nullification',()=>{
  const m=support('en_down1',{effect1:'direct',effect_target1:'self'}),b=make({moves:[m]});b.effects=new Map(b.effects);b.effects.set('direct',{...effects.get('en_down1'),effect_id:'direct',damage_value:2});add(b,'player','en_charge_zero');active(b).energy=0;const e=enact(b,m).events;assert.equal(active(b).energy,2);assert.equal(e.find(e=>e.type==='effect-energy').recovered,2);
});
test('EN cost increase affects zero-cost skills but not common dodge or switching',()=>{
  const m={...strike,cost:0},b=make({moves:[m,skills.get('skill_000')],player:[base(),base({character_id:'bench'})]});add(b,'player','en_cost_up1');active(b).energy=0;assert.equal(cost(b,'player',m),1);assert.match(go.checkAction(b,'player',use('attack')),/EN/);assert.equal(cost(b,'player',skills.get('skill_000')),0);assert.equal(go.checkAction(b,'player',use('skill_000')),'');assert.equal(go.checkAction(b,'player',{type:'switch',index:1}),'');assert.equal(m.cost,0);
});
test('selection, preview and actual payment use identical adjusted cost',()=>{
  const m={...strike,cost:1},b=make({moves:[m]});add(b,'player','en_cost_up1');active(b).energy=2;assert.equal(go.previewDamage(b,'player',m).energyCost,2);assert.equal(go.checkAction(b,'player',use('attack')),'');const e=enact(b,m).events;assert.equal(e.find(e=>e.type==='move').cost,2);assert.equal(active(b).energy,0);
});
for(const id of ['en_down1','en_cost_up1'])test('faster '+id+' invalidates already-selected move without payment',()=>{
  const m=support(id),hit={...strike,skill_id:'target-attack',cost:2},b=make({moves:[m,hit],enemy:[base({hp:2000,speed:20,skillIds:[hit.skill_id]})]});active(b,'enemy').energy=2;const e=enact(b,m,use(hit.skill_id)).events;assert.equal(e.filter(e=>e.type==='move'&&e.side==='enemy').length,0);assert.equal(e.filter(e=>e.type==='insufficient-energy').length,1);assert.equal(active(b,'enemy').energy,id==='en_down1'?1:2);assert.equal(active(b).hp,200);
});
test('same effect refreshes duration without stacking; different IDs accumulate',()=>{
  const m=support('en_cost_up1'),b=make({moves:[m]});enact(b,m);round(b);enact(b,m);assert.equal(active(b,'enemy').timedEffects.size,1);assert.equal(cost(b,'enemy',strike),3);const entry=active(b,'enemy').timedEffects.get('en_cost_up1');assert.equal(entry.expires-b.turn,2);
  const definition={...effects.get('en_cost_up1'),effect_id:'fixture_cost2',damage_value:2};b.effects=new Map(b.effects);b.effects.set(definition.effect_id,definition);add(b,'enemy',definition.effect_id);assert.equal(cost(b,'enemy',strike),5);
});
test('ordinary switch clears all EN modifiers without touching base data',()=>{
  const b=make({player:[base(),base({character_id:'bench'})]});for(const id of ['en_cost_up1','en_charge_zero','en_charge_down1'])add(b,'player',id);const f=active(b);go.resolveTurn(b,{player:{type:'switch',index:1},enemy:wait});assert.equal(f.timedEffects.size,0);assert.equal(f.base.energy_charge,0);assert.equal(active(b).timedEffects.size,0);
});
test('power relay neither retains nor transfers EN modifiers',()=>{
  const relay=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='relay'));assert.ok(relay);
  const b=make({moves:[relay],player:[base({skillIds:[relay.skill_id]}),base({character_id:'bench'})]});active(b).energy=7;add(b,'player','en_cost_up1');add(b,'player','en_charge_zero');active(b).stages.phy_atk=2;const old=active(b);enact(b,{...relay,skill_id:relay.skill_id},{type:'wait'}); // default onSwitch chooses the first valid bench
  assert.equal(b.active.player,1);assert.equal(old.timedEffects.size,0);assert.equal(active(b).timedEffects.size,0);assert.equal(active(b).stages.phy_atk,2);
});
for(const protection of ['dodge','immune','decoy'])test('attack blocked by '+protection+' does not apply EN secondary effect',()=>{
  const m={...strike,cost:0,element:protection==='immune'?'earth':'none',effect1:'en_down1',effect_target1:'enemy',effect_chance1:100};const b=make({moves:[m],enemy:[base({hp:2000,element_1:protection==='immune'?'wind':'none'})]});const target=active(b,'enemy');target.energy=3;if(protection==='dodge')target.dodgeActive=true;if(protection==='decoy')target.decoy={hp:1000,maxHp:1000};enact(b,m);assert.equal(target.energy,3);
});
test('skill chance 0 and self target are honored without special skill IDs',()=>{
  const m=support('en_down2',{effect_chance1:0}),b=make({moves:[m]});enact(b,m);assert.equal(active(b,'enemy').energy,1);
  const self=support('en_down2',{skill_id:'self-drop',effect_target1:'self'}),c=make({moves:[self]});active(c).energy=3;enact(c,self);assert.equal(active(c).energy,1);assert.equal(active(c,'enemy').energy,1);
});
test('repeat attack applies each effect slot once, preserving existing secondary-effect structure',()=>{
  const m={...strike,cost:0,repeat_count:3,effect1:'en_down1',effect_target1:'enemy',effect_chance1:100},b=make({moves:[m]});active(b,'enemy').energy=4;const events=enact(b,m).events;assert.equal(events.filter(e=>e.type==='effect-energy').length,1);assert.equal(active(b,'enemy').energy,3);
});
test('CSV-like values drive arbitrary effect IDs, amount and duration without JS changes',()=>{
  const m=support('fixture'),b=make({moves:[m]});b.effects=new Map(b.effects);b.effects.set('fixture',{...effects.get('en_charge_down1'),effect_id:'fixture',damage_value:-2,turn:2});active(b,'enemy').base={...active(b,'enemy').base,energy_charge:3};active(b,'enemy').energy=0;enact(b,m);assert.equal(active(b,'enemy').energy,1);round(b);assert.equal(active(b,'enemy').energy,2);assert.equal(active(b,'enemy').timedEffects.size,0);round(b);assert.equal(active(b,'enemy').energy,5);
});
test('EN kinds validate target/type/integer duration and preserve signed zero values',()=>{
  for(const id of ['en_down1','en_down2','en_drain1','en_charge_down1','en_charge_zero','en_cost_up1'])assert.ok(go.effectKind(effects.get(id)),id);
  for(const patch of [{turn:0},{turn:1.5},{target_stat:'hp'},{damage_value:NaN}])assert.equal(go.effectKind({...effects.get('en_charge_down1'),...patch}),null);
  assert.equal(go.effectKind({...effects.get('en_charge_zero'),damage_value:0}),'en-charge-modifier');assert.equal(go.effectKind({...effects.get('en_down1'),damage_value:-2}),'recover-en');
});
test('AI filters adjusted unaffordable skills and scores EN disruption without mutation or battle RNG',()=>{
  let rolls=0;const m=support('en_cost_up1'),hit={...strike,cost:1},b=make({moves:[m,hit],player:[base({skillIds:[m.skill_id,hit.skill_id]})],random:()=>{rolls++;return .99;}});active(b).energy=1;add(b,'player','en_cost_up1');const before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);const board=ai.observe(b,'player');const result=ai.evaluate(board);assert.ok(result.every(e=>e.action.moveId!=='attack'));assert.ok(result.some(e=>e.action.moveId===m.skill_id));assert.equal(rolls,0);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);
});
test('logs display actual signed energy, drain, timed changes and execution failure',()=>{
  const describe=get('describeGeneOrderEvent');assert.match(describe({type:'effect-energy',actor:'Gene',recovered:-1}),/EN −1/);assert.match(describe({type:'en-drain',user:'A',actor:'B',lost:1,recovered:0}),/1吸収.*\+0/);assert.match(describe({type:'en-modifier',actor:'B',name:'消費EN1増加',turns:3}),/消費EN1増加.*3ターン/);assert.match(describe({type:'insufficient-energy',actor:'B',move:'技',cost:2,energy:1}),/EN不足.*EN消費なし/);
});

test('charge reservation pays adjusted EN once; later EN loss does not charge release again',()=>{
  const m=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='charge'));assert.ok(m);
  const b=make({moves:[m],player:[base({skillIds:[m.skill_id]})]});active(b).energy=7;add(b,'player','en_cost_up1');const expected=m.cost+1;const first=enact(b,m).events;assert.equal(first.find(e=>e.type==='charge').cost,expected);assert.ok(active(b).pending);active(b).energy=0;assert.equal(cost(b,'player',m),0);const second=enact(b,m).events;assert.equal(second.find(e=>e.type==='move').cost,0);assert.equal(active(b).energy,0);
});
test('zero-charge suppression does not block battle-start passive EN, and preview leaves state intact',()=>{
  const b=make({player:[base({passive_id:'passive_003'})]});const f=active(b);const before=f.energy;assert.equal(before,4);add(b,'player','en_charge_zero');assert.equal(f.energy,before);const beforeState=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);go.previewDamage(b,'player',strike);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),beforeState);
});
test('AI values fresh EN cost interference above pointless full-duration reapplication',()=>{
  const m=support('en_cost_up1'),b=make({moves:[m]});const value=()=>ai.evaluate(ai.observe(b,'player')).find(e=>e.action.moveId===m.skill_id).score;const initial=value();add(b,'enemy','en_cost_up1');assert.ok(initial>value());
});

test('CSV reload normalizes changed EN magnitude, zero and duration before a new battle',()=>{
  const source=read('data/effect.csv');const updated=source.replace('en_charge_down1,EN回復量1減少,en_charge_modifier,none,-1,3,','en_charge_down1,EN回復量1減少,en_charge_modifier,none,-2,2,');const loaded=new Map(get('rowsFromCsv')(updated).map(r=>[r.effect_id,get('normalizeEffect')(r)]));assert.equal(loaded.get('en_charge_zero').damage_value,0);
  const m=support('en_charge_down1'),b=make({moves:[m],effects:loaded,enemy:[base({hp:2000,energy_charge:3})]});active(b,'enemy').energy=0;enact(b,m);assert.equal(active(b,'enemy').energy,1);round(b);assert.equal(active(b,'enemy').energy,2);assert.equal(active(b,'enemy').timedEffects.size,0);round(b);assert.equal(active(b,'enemy').energy,5);
});

// Positive natural-recovery modifiers reuse the same CSV-driven handler.
const up='en_charge_up1';
test('EN charge-up CSV matches the requested 13-column definition',()=>{const row=rows('effect').find(r=>r.effect_id===up),down=rows('effect').find(r=>r.effect_id==='en_charge_down1');assert.equal(row.name,'EN回復量1増加');assert.equal(row.damage_value,'1');assert.equal(row.start_text,'{target}のEN自然回復量が1増加した！');for(const key of Object.keys(down).filter(k=>!['effect_id','name','damage_value','start_text'].includes(k)))assert.equal(row[key],down[key]);assert.equal(go.effectKind(effects.get(up)),'en-charge-modifier');});
for(const target of ['self','enemy'])test('charge +1 lasts exactly three recoveries including application, then restores base: '+target,()=>{const side=target==='self'?'player':'enemy',m=support(up,{effect_target1:target}),b=make({moves:[m],player:[base({energy_charge:1,skillIds:[m.skill_id]})],enemy:[base({hp:2000,energy_charge:1})],captureFrame:(board,e)=>({type:e.type,en:go.activeFighter(board,side).energy})}),f=active(b,side);f.energy=0;const first=enact(b,m);assert.equal(first.frames.find(e=>e.type==='en-modifier').en,0);assert.equal(first.events.some(e=>e.type==='effect-energy'),false);assert.equal(f.energy,2);assert.equal(charge(b,side),2);round(b);assert.equal(f.energy,4);const last=round(b).events;assert.equal(f.energy,6);assert.equal(f.timedEffects.has(up),false);assert.equal(charge(b,side),1);assert.equal(f.base.energy_charge,1);assert.equal(last.filter(e=>e.type==='effect-expired'&&e.name===effects.get(up).name).length,1);f.energy=0;round(b);assert.equal(f.energy,1);});
test('charge-up recovery caps at existing maximum EN',()=>{const m=support(up),b=make({moves:[m],enemy:[base({hp:2000,energy_charge:2})]});active(b,'enemy').energy=6;const e=enact(b,m).events;assert.equal(active(b,'enemy').energy,go.MAX_ENERGY);assert.equal(e.find(e=>e.type==='energy'&&e.side==='enemy').recovered,1);});
for(const baseCharge of [0,1,2])test('up/down addition cancels before floor independent of application order: '+baseCharge,()=>{for(const ids of [[up,'en_charge_down1'],['en_charge_down1',up]]){const b=make({enemy:[base({hp:2000,energy_charge:baseCharge})]});for(const id of ids)add(b,'enemy',id);assert.equal(charge(b),baseCharge);active(b,'enemy').energy=0;round(b);assert.equal(active(b,'enemy').energy,baseCharge);}});
for(const ids of [[up,'en_charge_down1','en_charge_zero'],['en_charge_zero',up,'en_charge_down1']])test('zero multiplier overrides positive and negative charge modifiers: '+ids.join('/'),()=>{const b=make({enemy:[base({hp:2000,energy_charge:2})]});for(const id of ids)add(b,'enemy',id);active(b,'enemy').energy=0;assert.equal(charge(b),0);round(b);assert.equal(active(b,'enemy').energy,0);});
test('reapplication refreshes duration without stacking the +1',()=>{const m=support(up),b=make({moves:[m]}),f=active(b,'enemy');f.energy=0;enact(b,m);round(b);const repeated=enact(b,m).events.find(e=>e.type==='en-modifier');assert.equal(repeated.replaced,true);assert.equal(f.timedEffects.size,1);assert.equal(charge(b),1);assert.equal(f.energy,3);round(b);assert.equal(f.energy,4);round(b);assert.equal(f.energy,5);assert.equal(f.timedEffects.size,0);round(b);assert.equal(f.energy,5);});
for(const id of [up,'en_charge_down1'])test('normal switching clears individual EN modifier identically: '+id,()=>{const m=support(id,{effect_target1:'self'}),b=make({moves:[m],player:[base({energy_charge:1,skillIds:[m.skill_id]}),base({character_id:'bench',energy_charge:0})]}),f=active(b);enact(b,m);assert.equal(f.timedEffects.has(id),true);go.resolveTurn(b,{player:{type:'switch',index:1},enemy:wait});assert.equal(f.timedEffects.size,0);const en=f.energy;round(b);assert.equal(f.energy,en);go.resolveTurn(b,{player:{type:'switch',index:0},enemy:wait});assert.equal(charge(b,'player'),1);assert.equal(f.base.energy_charge,1);});
test('power relay does not transfer charge-up to the entrant',()=>{const relay=[...skills.values()].find(m=>go.moveEffects(m).some(e=>go.battleEffectKind(defenses.get(e.id))==='relay')),b=make({moves:[relay],player:[base({skillIds:[relay.skill_id]}),base({character_id:'bench'})]});active(b).energy=7;add(b,'player',up);const projected=go.previewSwitch(b,'player',1,'relay');assert.equal(active(projected).timedEffects.has(up),false);enact(b,relay);assert.equal(active(b).timedEffects.has(up),false);assert.equal(b.teams.player[0].timedEffects.has(up),false);});
test('CSV-only magnitude and duration changes reload without engine changes',()=>{const source=read('data/effect.csv').replace('en_charge_up1,EN回復量1増加,en_charge_modifier,none,1,3,','en_charge_up1,EN回復量1増加,en_charge_modifier,none,2,2,'),loaded=new Map(get('rowsFromCsv')(source).map(r=>[r.effect_id,get('normalizeEffect')(r)])),m=support(up),b=make({moves:[m],effects:loaded}),f=active(b,'enemy');f.energy=0;enact(b,m);assert.equal(f.energy,2);round(b);assert.equal(f.energy,4);assert.equal(f.timedEffects.size,0);round(b);assert.equal(f.energy,4);});
test('zero-probability charge-up does not apply or recover EN',()=>{const m=support(up,{effect_chance1:0}),b=make({moves:[m]}),f=active(b,'enemy');f.energy=0;enact(b,m);assert.equal(f.energy,0);assert.equal(f.timedEffects.size,0);});
