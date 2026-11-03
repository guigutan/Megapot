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

function claimFixture(options={}) {
 const a=app();const account='0x1111111111111111111111111111111111111111';
 const state={winningTicket:1n,payoutCalculator:'0x2222222222222222222222222222222222222222',referralWinShare:100000000000000000n};
 const nft={ownerOf:async()=>options.owner||account,getTicketInfo:async()=>({drawingId:options.round||223n})};
 a.context.ethers={Contract:class{constructor(address){return address==='nft'?nft:{getDrawingTierPayouts:async()=>Array(12).fill(options.gross??1000001n)}}}};
 a.context.c={runner:{},jackpotNFT:async()=>'nft',currentDrawingId:async()=>224n,getDrawingState:async()=>state,getTicketTierIds:async()=>[4n]};
 a.context.account=account;
 return a;
}
test('claim preflight checks owner, settled round, prize and exact net amount',async()=>{
 const a=claimFixture();const verified=await a.run('verifyClaim(c,account,123n)');
 assert.equal(verified.net,900001n);assert.equal(verified.tier,4);assert.equal(verified.round,223n);
 await assert.rejects(()=>claimFixture({owner:'other'}).run('verifyClaim(c,account,123n)'),/持有人/);
 await assert.rejects(()=>claimFixture({round:224n}).run('verifyClaim(c,account,123n)'),/结算/);
 await assert.rejects(()=>claimFixture({gross:0n}).run('verifyClaim(c,account,123n)'),/没有可领取/);
});
test('ticket IDs preserve uint256 precision and reject malformed values',()=>{
 const {run}=app();assert.equal(run("ticketIdValue('123456789012345678901234567890')"),123456789012345678901234567890n);
 for(const value of ['-1','1.5','1e5','0x123','',String(2n**256n)])assert.throws(()=>run(`ticketIdValue('${value}')`));
});
test('claim does not send after simulation rejection and restores controls',async()=>{
 const a=app();let sends=0;
 const write=async()=>{sends++;};write.staticCall=async()=>{throw Error('already claimed')};
 a.context.ethers={Contract:class{constructor(){return {claimWinnings:write}}}};
 a.run("connect=async()=>({account:'wallet',signer:{}});assertWallet=async()=>{};verifyClaim=async()=>({round:223n,tier:4,net:900001n})");
 await a.run("claimTicket('123')");assert.equal(sends,0);
 assert.match(a.elements.get('claimStatus').textContent,/already claimed/);
 assert.equal(a.elements.get('manualClaim').disabled,false);
});
test('claim reports success only after receipt and blocks duplicate requests',async()=>{
 const a=app();let sends=0;let finish;
 const pending=new Promise(resolve=>{finish=resolve});
 const write=async()=>{sends++;return {hash:'0xabc',wait:()=>pending}};write.staticCall=async()=>{};
 a.context.ethers={Contract:class{constructor(){return {claimWinnings:write}}}};
 a.run("connect=async()=>({account:'wallet',signer:{}});assertWallet=async()=>{};verifyClaim=async()=>({round:223n,tier:4,net:900001n})");
 const first=a.run("claimTicket('123')");
 for(let i=0;i<12;i++)await Promise.resolve();
 await a.run("claimTicket('123')");assert.equal(sends,1);
 assert.doesNotMatch(a.elements.get('claimStatus').textContent,/领取成功/);
 finish({status:1});await first;
 assert.match(a.elements.get('claimStatus').textContent,/领取成功/);
});
test('wallet change stops claim before signing',async()=>{
 const a=app();let sends=0;
 const write=async()=>{sends++};write.staticCall=async()=>{};
 a.context.ethers={Contract:class{constructor(){return {claimWinnings:write}}}};
 a.run("connect=async()=>({account:'wallet',signer:{}});verifyClaim=async()=>({round:223n,tier:4,net:1n});assertWallet=async()=>{throw Error('钱包已改变')}");
 await a.run("claimTicket('123')");assert.equal(sends,0);assert.match(a.elements.get('claimStatus').textContent,/钱包已改变/);
});

test('cached wallet is reused without requesting access again and triggers one automatic query',async()=>{
 const a=app();let prompts=0,queries=0,signers=0;
 const account='0x1111111111111111111111111111111111111111';
 a.context.window.ethereum={request:async({method})=>{if(method==='eth_accounts')return [account];if(method==='eth_chainId')return '0x2105';prompts++;throw Error('unexpected prompt')}};
 a.context.ethers={BrowserProvider:class{async getSigner(){signers++;return {getAddress:async()=>account}}}};
 a.context.loaded=()=>{queries++};a.run('queryWins=async()=>loaded()');
 await a.run('connect()');await a.run('connect()');
 assert.equal(prompts,0);assert.equal(signers,1);assert.equal(queries,1);
 assert.equal(a.elements.get('winsQuery').hidden,false);
});
test('batch IDs deduplicate and enforce 50-ticket maximum',()=>{
 const a=app();assert.equal(a.run("batchIds(['1','1','2']).join(',')"),'1,2');
 assert.throws(()=>a.run('batchIds([])'),/1–50/);
 assert.throws(()=>a.run('batchIds(Array.from({length:51},(_,i)=>i))'),/1–50/);
});
test('cross-round batch verifies every ticket and sends exactly one transaction',async()=>{
 const a=app();const verified=[],simulations=[],sent=[];
 const write=async ids=>{sent.push([...ids]);return {hash:'0xabc',wait:async()=>({status:1})}};
 write.staticCall=async ids=>simulations.push([...ids]);
 a.context.ethers={Contract:class{constructor(){return {claimWinnings:write}}}};
 a.context.record=id=>verified.push(id);
 a.run("connect=async()=>({account:'wallet',signer:{}});assertWallet=async()=>{};verifyClaim=async(c,account,id)=>{record(id);return {round:id,tier:4,net:1000000n}}");
 await a.run("claimTickets(['222','223'])");
 assert.deepEqual(verified,[222n,223n]);assert.deepEqual(simulations,[[222n,223n]]);assert.deepEqual(sent,[[222n,223n]]);
 assert.match(a.elements.get('claimStatus').textContent,/领取成功/);
});
test('one stale ticket aborts the entire batch before sending',async()=>{
 const a=app();let sends=0;
 const write=async()=>{sends++};write.staticCall=async()=>{};
 a.context.ethers={Contract:class{constructor(){return {claimWinnings:write}}}};
 a.run("connect=async()=>({account:'wallet',signer:{}});assertWallet=async()=>{};verifyClaim=async(c,account,id)=>{if(id===2n)throw Error('已领取');return {net:1n}}");
 await a.run("claimTickets(['1','2'])");assert.equal(sends,0);assert.match(a.elements.get('claimStatus').textContent,/已领取/);
 assert.equal(a.elements.get('manualClaim').disabled,false);
});

test('purchase record states distinguish pending, losing, unclaimed and claimed tickets',()=>{
 const {run}=app();
 assert.equal(run('recordOutcome({matched_normals:null,bonusball_match:null,winnings_amount:null})'),'待开奖 / 待索引更新');
 assert.equal(run("recordOutcome({matched_normals:1,bonusball_match:false,winnings_amount:{amount:'0',decimals:6}})"),'1+0 · 未中奖');
 assert.equal(run("recordOutcome({matched_normals:2,bonusball_match:false,claimed:false,winnings_amount:{amount:'1000001',decimals:6}})"),'2+0 · 待领取 · 索引奖金 1.000001 USDC');
 assert.match(run("recordOutcome({matched_normals:5,bonusball_match:true,claimed:true,winnings_amount:{amount:'123456789',decimals:6}})"),/已领取/);
});
test('purchase records paginate using cursor, deduplicate and reject other wallets',async()=>{
 const a=app();const cursors=[],rendered=[];
 a.context.getPage=async(account,cursor)=>{cursors.push(cursor);return cursor===null ? {data:[{wallet:'wallet',user_ticket_id:'1'}],has_more:true,next_cursor:'page2'} : {data:[{wallet:'wallet',user_ticket_id:'1'},{wallet:'wallet',user_ticket_id:'2'},{wallet:'other',user_ticket_id:'3'}],has_more:false,next_cursor:null}};
 a.context.rendered=rendered;
 a.run("connectedWallet={account:'wallet',epoch:0};connect=async()=>connectedWallet;assertWallet=async()=>{};fetchRecords=getPage;renderRecord=t=>rendered.push(t.user_ticket_id)");
 await a.run('queryRecords()');assert.equal(a.elements.get('recordsMore').hidden,false);
 await a.run('queryRecords(true)');assert.deepEqual(cursors,[null,'page2']);assert.deepEqual(rendered,['1','2']);
 assert.equal(a.elements.get('recordsMore').hidden,true);assert.match(a.elements.get('recordsStatus').textContent,/2 张/);
});
test('purchase records discard responses invalidated by a wallet switch',async()=>{
 const a=app();let finish;const rendered=[];
 a.context.getPage=()=>new Promise(resolve=>{finish=resolve});a.context.rendered=rendered;
 a.run("connectedWallet={account:'old',epoch:0};connect=async()=>connectedWallet;assertWallet=async()=>{};fetchRecords=getPage;renderRecord=t=>rendered.push(t.user_ticket_id)");
 const request=a.run('queryRecords()');await Promise.resolve();await Promise.resolve();
 a.run('connectedWallet=null;resetRecords()');
 finish({data:[{wallet:'old',user_ticket_id:'1'}],has_more:false,next_cursor:null});await request;
 assert.deepEqual(rendered,[]);assert.equal(a.elements.get('recordsQuery').hidden,true);
});
test('record refresh failure preserves already loaded pages and unlocks controls',async()=>{
 const a=app();
 a.run("connectedWallet={account:'wallet',epoch:0};connect=async()=>connectedWallet;assertWallet=async()=>{};fetchRecords=async()=>({data:[{wallet:'wallet',user_ticket_id:'1',round_id:'223',normals:[1,2,3,4,5],bonusball:1,matched_normals:null,bonusball_match:null,winnings_amount:null}],has_more:true,next_cursor:'next'})");
 await a.run('queryRecords()');a.run("fetchRecords=async()=>{throw Error('限流')}");await a.run('queryRecords(true)');
 assert.equal(a.elements.get('purchaseRecords').children.length,1);assert.match(a.elements.get('recordsStatus').textContent,/限流/);
 assert.equal(a.elements.get('recordsMore').disabled,false);
});
