'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function app() {
 const elements = new Map();
 const element = () => ({textContent:'',className:'',value:'',disabled:false,children:[],addEventListener(){},append(...v){this.children.push(...v)},replaceChildren(){this.children=[]}});
 const context = vm.createContext({console, Date, Set, Number, BigInt, document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}, createElement:element}, window:{setInterval(){}}});
 vm.runInContext(fs.readFileSync('app.js','utf8'),context);
 return {context,elements,run: code => vm.runInContext(code,context)};
}
test('validates integers, bounds, duplicates, missing values and sorts a copy',()=>{
 const {run} = app();
 assert.equal(run('JSON.stringify(validateTicket([30,1,9,3,8],7,7).normals)'), '[1,3,8,9,30]');
 for(const code of ['validateTicket([1,2,3,4,4],1,7)','validateTicket([0,2,3,4,5],1,7)','validateTicket([31,2,3,4,5],1,7)','validateTicket([1.5,2,3,4,5],1,7)','validateTicket([1,2,3,4,5],8,7)','validateTicket([1,2,3,4,5],1.2,7)','validateTicket([1,2,3,4,5],0,7)','validateTicket([1,2,3,4,5],1,NaN)']) assert.throws(()=>run(code));
});
test('history includes settled current round, skips unsettled and stops at requested count',async()=>{
 const {run,elements,context} = app();
 context.contractMock={getDrawingState:async id=>({winningTicket:id===3n?0n:1n,drawingTime:1n}),getUnpackedTicket:async()=>({normals:[1n,2n,3n,4n,5n],bonusball:7n})};
 run('initReader = () => contractMock; snapshot = async () => ({id:4n});');
 run("$('count').value='2'");
 await run('history({preventDefault(){}})');
 assert.equal(elements.get('results').children.length,2);
 assert.match(elements.get('results').children[0].children[0].textContent,/第 4 期/);
 assert.match(elements.get('results').children[1].children[0].textContent,/第 2 期/);
 assert.equal(elements.get('historyButton').disabled,false);
});
test('history preserves successful results and unlocks button after RPC failure',async()=>{
 const {run,elements,context}=app();
 context.contractMock={getDrawingState:async id=>{if(id===1n)throw Error('RPC unavailable');return {winningTicket:1n,drawingTime:1n}},getUnpackedTicket:async()=>({normals:[1n,2n,3n,4n,5n],bonusball:1n})};
 run('initReader = () => contractMock; snapshot = async () => ({id:2n});');
 run("$('count').value='2'");await run('history({preventDefault(){}})');
 assert.equal(elements.get('results').children.length,1);
 assert.match(elements.get('historyStatus').textContent,/已保留 1 期/);
 assert.equal(elements.get('historyButton').disabled,false);
});

test('countdown handles days, deadline, settlement and locked rounds',()=>{
 const {run}=app();
 assert.equal(run('countdownText({drawingTime:90061n,winningTicket:0n,jackpotLock:false},0)'), '1天 01:01:01');
 assert.equal(run('countdownText({drawingTime:60n,winningTicket:0n,jackpotLock:false},59500)'), '00:00:01');
 assert.equal(run('countdownText({drawingTime:60n,winningTicket:0n,jackpotLock:false},60000)'), '等待链上开奖');
 assert.equal(run('countdownText({drawingTime:60n,winningTicket:0n,jackpotLock:false},61000)'), '等待链上开奖');
 assert.equal(run('countdownText({drawingTime:60n,winningTicket:0n,jackpotLock:true},0)'), '开奖处理中');
 assert.equal(run('countdownText({drawingTime:60n,winningTicket:1n,jackpotLock:true},0)'), '本期已开奖');
 assert.equal(run('countdownText(undefined,0)'), '—');
});
test('current state renders exact USDC pool amount and replaces countdown on round change',()=>{
 const {run,context,elements}=app();
 context.ethers={formatUnits: value=>`${value/1000000n}.${(value%1000000n).toString().padStart(6,'0')}`};
 run('showCurrent({id:5n,state:{prizePool:1234567890123n,ticketPrice:1000000n,drawingTime:60n,winningTicket:0n,jackpotLock:true,bonusballMax:10n}})');
 assert.equal(elements.get('prizePool').textContent,'1,234,567.890123');
 assert.equal(elements.get('countdown').textContent,'开奖处理中');
 run('showCurrent({id:6n,state:{prizePool:0n,ticketPrice:1000000n,drawingTime:60n,winningTicket:1n,jackpotLock:false,bonusballMax:10n}})');
 assert.equal(elements.get('prizePool').textContent,'0');
 assert.equal(elements.get('countdown').textContent,'本期已开奖');
});

test('past tier reads use each drawing calculator and saved round ID',async()=>{
 const {run,context}=app();const calls=[];
 context.ethers={Contract:class{constructor(address,abi,runner){calls.push({address,abi,runner})}async getDrawingTierInfo(id){calls.push(['config',id]);return {minPayout:1n}}async getDrawingTierPayouts(id){calls.push(['payouts',id]);return Array(12).fill(5n)}}};
 context.c={runner:{name:'read-provider'}};
 const result=await run("readPastTiers(c,42n,{payoutCalculator:'0x1111111111111111111111111111111111111111'})");
 assert.equal(calls[0].address,'0x1111111111111111111111111111111111111111');
 assert.equal(calls[0].runner,context.c.runner);
 assert.deepEqual(calls.slice(1),[['config',42n],['payouts',42n]]);
 assert.equal(result.payouts.length,12);assert.equal(result.errors.length,0);
});
test('net prizes subtract rounded share and retain all six USDC decimals',()=>{
 const {run}=app();
 assert.equal(run('netPayout(1000001n,100000000000000000n)'),900001n);
 assert.equal(run('formatScaled(netPayout(1000001n,100000000000000000n),6)'), '0.900001');
 assert.equal(run('formatScaled(0n,6)'), '0');
 assert.equal(run('percent(123456789012345678n)'), '12.3456789012345678%');
});
test('failed weight lookup preserves final prizes and distinguishes missing values from zero',async()=>{
 const {run,context}=app();
 context.ethers={Contract:class{async getDrawingTierInfo(){throw Error('configuration unavailable')}async getDrawingTierPayouts(){return Array(12).fill(1000001n)}}};
 context.c={runner:{}};
 const data=await run("readPastTiers(c,7n,{payoutCalculator:'0x2222222222222222222222222222222222222222'})");
 assert.equal(data.config,null);assert.equal(data.errors.length,1);
 context.data=data;
 const host=run("makeNode('div')");context.host=host;
 run("renderPastTiers(host,{prizePool:1000000000n,referralWinShare:100000000000000000n,payoutCalculator:'0x2222222222222222222222222222222222222222'},data)");
 const table=host.children.find(n=>n.className==='tier-scroll').children[0];
 const rows=table.children[2].children;
 assert.equal(rows.length,12);
 assert.deepEqual(rows.map(row => row.children[0].textContent), ['5+1','5+0','4+1','4+0','3+1','3+0','2+1','2+0','1+1','1+0','0+1','0+0']);
 assert.equal(rows[0].children[1].textContent,'未获取');
 assert.equal(rows[0].children[3].textContent,'1.000001');
 assert.equal(rows[0].children[4].textContent,'0.900001');
 assert.equal(rows[11].children[0].textContent,'0+0');
});
test('history automatically loads tier details for every settled drawing',async()=>{
 const {run,context}=app();const ids=[];context.ids=ids;
 context.contractMock={getDrawingState:async id=>({winningTicket:id===2n?0n:1n,drawingTime:1n}),getUnpackedTicket:async()=>({normals:[1n,2n,3n,4n,5n],bonusball:1n})};
 run("initReader=()=>contractMock; snapshot=async()=>({id:3n}); loadPastTiers=async(c,id)=>ids.push(id); $('count').value='2'");
 await run('history({preventDefault(){}})');assert.deepEqual(ids,[3n,1n]);
});
