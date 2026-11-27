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

const ranks=get('goStatRank');
const limits=[['G',40,95],['F',60,115],['E',80,135],['D',100,155],['C',120,175],['B',140,195],['A',160,215],['S',225,280],['SS',400,455],['SSS',600,655],['EX',Infinity,Infinity]];
for(const stat of ['hp','phy_atk','phy_def','sp_atk','sp_def','speed'])for(let i=0;i<limits.length;i++){
 const [grade,other,hp]=limits[i],upper=stat==='hp'?hp:other,lower=i?(stat==='hp'?limits[i-1][2]:limits[i-1][1])+1:0;
 test(stat+' inclusive '+grade+' lower/upper bounds',()=>{assert.equal(ranks(stat,lower).letter,grade);if(Number.isFinite(upper))assert.equal(ranks(stat,upper).letter,grade);else assert.equal(ranks(stat,1000000).letter,'EX');});
}
test('HP stays exactly 55 above the other-stat raw thresholds',()=>{for(const [,upper]of limits.filter(r=>Number.isFinite(r[1])))for(const n of [upper,upper+1])assert.equal(ranks('hp',n+55).letter,ranks('phy_atk',n).letter);});
test('G-S colors stay unchanged and new ranks remain readable against black',()=>{const colors={G:'#A855F7',F:'#35CFFF',E:'#9ACD32',D:'#FFFF00',C:'#FFA500',B:'#FF0000',A:'#FF69B4',S:'#F7B9D4',SS:'#FFD700',SSS:'#7DF9FF',EX:'#FFFFFF'};for(const r of get('GO_STAT_RANKS'))assert.equal(r.color,colors[r.letter]);for(const n of [226,401,601]){const rgb=ranks('phy_atk',n).color.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];assert.ok((luminance+.05)/.05>=4.5);}});
for(const [stage,value,grade]of [[-6,40,'G'],[0,160,'A'],[1,240,'SS'],[3,400,'SS'],[4,480,'SSS'],[6,640,'EX']])test('battle effective PA rank at stage '+stage,()=>{const b=make({player:[base({phy_atk:160})]}),f=active(b);f.stages.phy_atk=stage;assert.equal(go.statValue(f,'phy_atk'),value);assert.equal(ranks('phy_atk',value).letter,grade);const html=ui.battleStatMarkup('phy_atk',value,stage);assert.ok(html.includes('>'+grade+'</span>'));assert.ok(html.includes('>'+value+'</strong>'));});
test('a temporary effective-stat reduction updates the displayed grade without altering ranks',()=>{const b=make({player:[base({phy_atk:160})]}),f=active(b);f.stages.phy_atk=6;assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'EX');attach(f,'burn');assert.equal(go.statValue(f,'phy_atk'),320);assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'SS');assert.equal(f.stages.phy_atk,6);f.statuses=[];assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'EX');});
test('a real Copen form change updates HP and PA grades through the same helper',()=>{const fd=get('geneOrderFormData'),forms=new Map(rows('form').map(fd.normalize).map(f=>[f.form_id,f])),species=get('masterIdLookup')(rows('species'),'species_id'),c=get('normalizeCharacter')(rows('character').find(r=>r.character_id==='character_040'),elements,species),b=make({forms,player:[{...c,skillIds:['attack']}]}),f=active(b);assert.equal(ranks('hp',f.maxHp).letter,'D');assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'E');go.applyHPDamage(f,76,{side:'player',events:[]});assert.equal(f.form.form_id,'copen_true');assert.equal(ranks('hp',f.maxHp).letter,'S');assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'A');f.stages.phy_atk=6;assert.equal(ranks('phy_atk',go.statValue(f,'phy_atk')).letter,'SSS');});
test('current card values determine grades even when a graph baseline is supplied',()=>{const render=get('goCharacterStat');assert.match(render('phy_atk',601,{baseValue:40}),/>EX<\/span>/);assert.match(render('hp',656,{baseValue:95}),/>EX<\/span>/);assert.equal(ranks('regen_value',1000),null);assert.equal(ranks('evasion_percent',1000),null);for(const v of [NaN,Infinity,-Infinity,'601'])assert.equal(ranks('phy_atk',v),null);});
test('high-grade rendering keeps opponent values hidden and never changes game data or RNG',()=>{let rolls=0;const b=make({player:[base({phy_atk:640})],random:()=>{rolls++;return .5;}}),before=JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v);const html=ui.battleStatMarkup('phy_atk',640,6,true);assert.match(html,/>EX<\/span>/);assert.doesNotMatch(html,/640|detail-stat-value/);get('goCharacterStat')('phy_atk',640);assert.equal(JSON.stringify(b,(_,v)=>v instanceof Map?[...v]:v),before);assert.equal(rolls,0);});
