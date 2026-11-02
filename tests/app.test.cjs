'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function app() {
 const elements = new Map();
 const element = () => ({textContent:'',className:'',value:'',disabled:false,children:[],addEventListener(){},append(...v){this.children.push(...v)},replaceChildren(){this.children=[]}});
 const context = vm.createContext({console, Date, Set, Number, BigInt, document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}, createElement:element}, window:{}});
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
