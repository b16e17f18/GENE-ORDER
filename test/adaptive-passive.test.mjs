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



const gp=get('geneOrderPassives'),stats=['phy_atk','phy_def','sp_atk','sp_def','speed'];
const uniform=()=>Object.fromEntries(stats.map(s=>[s,100]));
const adaptiveFixture=gp.normalize({passive_id:'passive_035',name:'固定1.5倍のアルゴリズム検証',passive_type1:'adaptive_stat_multiplier',target_id1:'auto',value1:'1.5'},elements,statusIds,types);
function battle({own={},enemy={},enemies,players,passive=adaptiveFixture,random=()=>.99}={}){return make({moves:[{...strike,cost:0}],passives:new Map([['passive_035',passive]]),player:players??[base({...uniform(),character_id:'character_035',name:'UMA',passive_id:'passive_035',...own})],enemy:enemies??[base({...uniform(),character_id:'foe',name:'Foe',...enemy})],random});}
const val=(b,key)=>go.statValue(active(b),key,{opponent:active(b,'enemy')});
const selected=b=>gp.adaptiveStat(active(b),active(b,'enemy'));
const cast=b=>go.resolveTurn(b,{player:use('attack'),enemy:wait});
const snapshot=b=>JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);

test('formal UMA references the new CSV-driven adaptive handler and auto target',()=>{const row=rows('character').find(r=>r.character_id==='character_035');assert.equal(row.passive_id,'passive_035');const p=passives.get(row.passive_id);assert.equal(p.name,rows('passive').find(r=>r.passive_id===row.passive_id).name);assert.equal(p.status,'implemented');assert.equal(p.effects[0].handler,'adaptive_stat_multiplier');assert.equal(p.effects[0].value,Number(rows('passive').find(r=>r.passive_id===row.passive_id).value1));assert.equal(types.types.size,38);assert.deepEqual([...types.issues],[]);});
for(const key of stats)test('largest positive base gap selects '+key+' only',()=>{const b=battle({enemy:{[key]:180}});assert.equal(selected(b),key);for(const stat of stats){assert.equal(val(b,stat),stat===key?150:100);assert.equal(active(b).stages[stat],0);}assert.equal(active(b).hp,200);});
for(const delta of [0,-1,-50])test('no boost when all opponents base stats are equal or lower: '+delta,()=>{const b=battle({enemy:Object.fromEntries(stats.map(s=>[s,100+delta]))});assert.equal(selected(b),null);for(const key of stats)assert.equal(val(b,key),100);});
for(let index=0;index<stats.length;index++)test('ties preserve PA PD SA SD SP priority starting at '+stats[index],()=>{const enemy=Object.fromEntries(stats.map((key,i)=>[key,i>=index?150:90])),b=battle({enemy});assert.equal(selected(b),stats[index]);});
test('comparison uses absolute gaps, not ratios or maximum enemy stat',()=>{const b=battle({own:{sp_atk:200,speed:20},enemy:{sp_atk:250,speed:60}});assert.equal(selected(b),'sp_atk');assert.equal(val(b,'sp_atk'),300);assert.equal(val(b,'speed'),20);});
test('HP and recovery are excluded even with the largest difference',()=>{const b=battle({enemy:{hp:99999,regen_value:500,phy_def:101}});assert.equal(selected(b),'phy_def');assert.equal(val(b,'phy_def'),150);});
for(const stage of [-3,-1,0,1,3])test('adaptive multiplier stacks independently with stage '+stage,()=>{const b=battle({enemy:{phy_atk:200}}),f=active(b),t=active(b,'enemy');f.stages.phy_atk=stage;t.stages.phy_def=6;const ranked=stage>=0?100*(2+stage)/2:100*2/(2-stage);assert.equal(val(b,'phy_atk'),Math.floor(ranked*1.5));assert.equal(selected(b),'phy_atk');assert.equal(f.stages.phy_atk,stage);});
test('effective enemy stages and own status do not change the base-stat comparison',()=>{const b=battle({enemy:{phy_atk:150,phy_def:140}}),f=active(b),t=active(b,'enemy');f.stages.phy_atk=-6;f.stages.phy_def=6;t.stages.phy_atk=-6;t.stages.phy_def=6;f.statuses.push({definition:{...effects.get('burn'),stat_modifier_target:'phy_atk',stat_modifier_multiplier:.5},turns:3});assert.equal(selected(b),'phy_atk');assert.equal(val(b,'phy_atk'),Math.floor(100*2/8*1.5*.5));});
test('other conditional multipliers cannot feed back into adaptive selection',()=>{const row={passive_id:'passive_035',name:'複合',passive_type1:'adaptive_stat_multiplier',target_id1:'auto',value1:'1.5',passive_type2:'conditional_stat_multiplier',target_id2:'pd',value2:'3',condition2:'self_hp_eq:1/1'},p=gp.normalize(row,elements,statusIds,types),b=battle({passive:p,enemy:{phy_atk:200,phy_def:150}});assert.equal(selected(b),'phy_atk');assert.equal(val(b,'phy_atk'),150);assert.equal(val(b,'phy_def'),300);});
test('enemy switch changes target and removes previous multiplier immediately',()=>{const b=battle({enemies:[base({...uniform(),phy_atk:180}),base({...uniform(),character_id:'bench',speed:220})]});assert.equal(val(b,'phy_atk'),150);go.resolveTurn(b,{player:wait,enemy:{type:'switch',index:1}});assert.equal(selected(b),'speed');assert.equal(val(b,'phy_atk'),100);assert.equal(val(b,'speed'),150);go.resolveTurn(b,{player:wait,enemy:{type:'switch',index:0}});assert.equal(selected(b),'phy_atk');assert.equal(val(b,'speed'),100);});
test('UMA switches out and re-enters without accumulating a previous boost',()=>{const b=battle({players:[base({...uniform(),passive_id:'passive_035'}),base({...uniform(),character_id:'bench'})],enemy:{sp_def:200}}),uma=active(b);assert.equal(val(b,'sp_def'),150);go.resolveTurn(b,{player:{type:'switch',index:1},enemy:wait});assert.equal(val(b,'sp_def'),100);go.resolveTurn(b,{player:{type:'switch',index:0},enemy:wait});assert.equal(active(b),uma);for(let i=0;i<20;i++)assert.equal(val(b,'sp_def'),150);assert.equal(uma.base.sp_def,100);assert.equal(uma.stages.sp_def,0);});
test('no opponent or fainted opponent gives no adaptive bonus',()=>{const b=battle({enemy:{speed:300}}),f=active(b),t=active(b,'enemy');assert.equal(go.statValue(f,'speed'),100);t.hp=0;t.fainted=true;assert.equal(val(b,'speed'),100);});
test('both adaptive fighters avoid circular references and follow their base differences',()=>{const b=battle({own:{phy_atk:80,phy_def:150},enemy:{phy_atk:150,phy_def:80,passive_id:'passive_035'}}),f=active(b),t=active(b,'enemy');assert.equal(val(b,'phy_atk'),120);assert.equal(go.statValue(t,'phy_def',{opponent:f}),120);assert.equal(selected(b),'phy_atk');});
test('AI preview and actual attack share the adaptive attack/defense multipliers without mutation',()=>{let rolls=0;const b=battle({enemy:{phy_atk:180,speed:10},random:()=>{rolls++;return .99;}}),before=snapshot(b),move=b.skills.get('attack'),p=go.previewDamage(b,'player',move),candidate=ai.evaluate(ai.observe(b,'player')).find(c=>c.action.moveId==='attack');assert.equal(p.attack,150);assert.equal(candidate.damage,p.actualDamage);assert.equal(snapshot(b),before);assert.equal(rolls,0);const e=cast(b).events.find(e=>e.type==='move');assert.equal(e.actualDamage,p.actualDamage);});
test('adaptive speed is included in real action order and AI speed forecasts',()=>{const b=battle({own:{speed:100},enemy:{speed:140}});assert.equal(go.effectiveSpeed(b,'player'),150);assert.equal(go.effectiveSpeed(b,'enemy'),140);const e=go.resolveTurn(b,{player:use('attack'),enemy:use('attack')}).events.filter(e=>e.type==='move');assert.equal(e[0].side,'player');});
test('switch preview is pure and recomputes the entrant adaptive stat',()=>{const b=battle({players:[base({...uniform()}),base({...uniform(),character_id:'uma',passive_id:'passive_035'})],enemy:{sp_atk:300}}),before=snapshot(b),p=go.previewSwitch(b,'player',1,'normal');assert.equal(snapshot(b),before);assert.equal(go.statValue(active(p),'sp_atk',{opponent:active(p,'enemy')}),150);});
test('CSV-only multiplier tuning and aliases reuse the handler without fixed 1.5 in code',()=>{const catalogRows=rows('passive_type');catalogRows.push({...catalogRows.find(r=>r.passive_type_id==='adaptive_stat_multiplier'),passive_type_id:'fixture_adaptive',aliases:'fixture_auto'});const catalog=gp.readTypes(catalogRows),p=gp.normalize({passive_id:'passive_035',name:'試験',passive_type1:'fixture_auto',target_id1:'auto',value1:'2'},elements,statusIds,catalog),b=battle({passive:p,enemy:{speed:300}});assert.deepEqual([...p.issues],[]);assert.equal(val(b,'speed'),200);});
test('GO validation rejects non-auto targets and nonpositive multipliers',()=>{for(const patch of [{target_id1:'pa',value1:'1.5'},{target_id1:'auto',value1:'0'},{target_id1:'auto',value1:'-1'}]){const p=gp.normalize({name:'不正',passive_type1:'adaptive_stat_multiplier',...patch},elements,statusIds,types);assert.ok(p.issues.length);}});

vm.runInContext(read('go-ui.js'),ctx);
for(const mode of ['manual','enemy','auto'])test('official '+mode+' match uses adaptive calculations through the common engine',()=>{const a=base({...uniform(),character_id:'character_035',passive_id:'passive_035',skillIds:['attack']}),t=base({...uniform(),character_id:'foe',phy_atk:180,skillIds:['attack']}),data={elements,characterMap:new Map([[a.character_id,a],[t.character_id,t]]),skills:new Map([['attack',{...strike,cost:0}]]),effects,battleEffects:defenses,powerRules,passives,effectiveness:chart},match=get('geneOrderUI').createMatch(data,{team:{player:[a.character_id],enemy:[t.character_id]},lead:{player:a.character_id,enemy:t.character_id},mode},{random:()=>.99,aiRoll:()=>.5});assert.equal(go.statValue(active(match.battle),'phy_atk',{opponent:active(match.battle,'enemy')}),Math.floor(100*passives.get('passive_035').effects[0].value));const result=match.resolve({player:use('attack'),enemy:use('attack')});assert.ok(result.events.length);for(const side of ['player','enemy']){const f=active(match.battle,side);assert.ok(Number.isFinite(f.hp));assert.ok(f.energy>=0&&f.energy<=7);}assert.equal(active(match.battle).base.phy_atk,100);});

for(const target of ['self','enemy'])test('AI status scoring ignores absent adaptive condition for '+target,()=>{const b=battle({enemy:{phy_atk:180,passive_id:'passive_035'}}),m={...statusMove('poison'),effect_target1:target,cost:0};b.skills.set(m.skill_id,m);active(b).base={...active(b).base,skillIds:['attack',m.skill_id]};const before=snapshot(b),candidate=ai.evaluate(ai.observe(b,'player')).find(c=>c.action.moveId===m.skill_id);assert.ok(candidate);assert.ok(Number.isFinite(candidate.score));assert.equal(snapshot(b),before);});
