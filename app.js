/* ABI checked against coordinationlabs/megapot-starter-kit (see README). */
'use strict';
const ADDRESS = '0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2';
const RPC = 'https://mainnet.base.org';
const ABI = [
 'function currentDrawingId() view returns (uint256)',
 'function getDrawingState(uint256) view returns ((uint256 prizePool,uint256 ticketPrice,uint256 edgePerTicket,uint256 referralWinShare,uint256 referralFee,uint256 globalTicketsBought,uint256 lpEarnings,uint256 drawingTime,uint256 winningTicket,uint8 ballMax,uint8 bonusballMax,address payoutCalculator,bool jackpotLock))',
 'function getUnpackedTicket(uint256,uint256) view returns (uint8[] normals,uint8 bonusball)',
 'function allowTicketPurchases() view returns (bool)',
 'function emergencyMode() view returns (bool)',
 'function usdc() view returns (address)',
 'function buyTickets((uint8[] normals,uint8 bonusball)[] tickets,address recipient,address[] referrers,uint256[] referralSplit,bytes32 source) returns (uint256[])'
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)','function decimals() view returns (uint8)','function symbol() view returns (string)'];
const $ = id => document.getElementById(id);
let reader, readContract, walletEpoch = 0, purchasing = false;
function status(id, message, kind = '') { $(id).textContent = message; $(id).className = kind; }
function errorText(error) {
 if (error.code === 4001 || error.code === 'ACTION_REJECTED') return '已取消钱包请求。';
 return error.shortMessage || error.reason || error.message || '请求失败，请重试。';
}
function initReader() {
 if (!window.ethers) throw new Error('ethers 加载失败，请检查网络并刷新页面。');
 if (!reader) {
  const connection = new ethers.FetchRequest(RPC); connection.timeout = 15000;
  reader = new ethers.JsonRpcProvider(connection, 8453, {staticNetwork: true});
  readContract = new ethers.Contract(ADDRESS, ABI, reader);
 }
 return readContract;
}
async function snapshot(c) {
 // Pin both reads to the same block so a draw rollover cannot mix rounds.
 const blockTag = await c.runner.provider.getBlockNumber();
 const id = await c.currentDrawingId({blockTag});
 return {id, state: await c.getDrawingState(id, {blockTag})};
}
function showCurrent({id, state}) {
 $('bonusMax').textContent = state.bonusballMax.toString();
 $('bonusLabel').textContent = state.bonusballMax.toString();
 $('bonus').max = state.bonusballMax.toString();
 $('round').textContent = `第 ${id} 期${state.jackpotLock ? ' · 开奖处理中' : ''}`;
 $('price').textContent = `单注票价 ${ethers.formatUnits(state.ticketPrice, 6)} USDC`;
 $('updated').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN')}`;
}
async function refresh() {
 $('refresh').disabled = true;
 try { showCurrent(await snapshot(initReader())); status('globalStatus', '当期状态已更新。'); }
 catch (e) { status('globalStatus', `读取失败：${errorText(e)}`, 'error'); }
 finally { $('refresh').disabled = false; }
}
function validateTicket(normals, bonusball, max, ballMax = 30) {
 if (normals.length !== 5 || normals.some(n => !Number.isInteger(n) || n < 1 || n > Math.min(30, ballMax))) throw new Error(`主号码必须是 1–${Math.min(30, ballMax)} 的 5 个整数。`);
 if (new Set(normals).size !== 5) throw new Error('5 个主号码不能重复。');
 if (!Number.isInteger(max) || max < 1) throw new Error('请先获取有效的 Bonus 上限。');
 if (!Number.isInteger(bonusball) || bonusball < 1 || bonusball > max) throw new Error(`Bonus 号码必须是 1–${max} 的整数。`);
 return {normals: [...normals].sort((a,b) => a-b), bonusball};
}
async function connect() {
 if (!window.ethereum) throw new Error('请安装 MetaMask 或其他兼容的浏览器钱包。');
 await window.ethereum.request({method: 'eth_requestAccounts'});
 const chain = await window.ethereum.request({method: 'eth_chainId'});
 if (chain !== '0x2105') await window.ethereum.request({method: 'wallet_switchEthereumChain', params: [{chainId:'0x2105'}]});
 if (await window.ethereum.request({method:'eth_chainId'}) !== '0x2105') throw new Error('请切换到 Base 主网。');
 const provider = new ethers.BrowserProvider(window.ethereum);
 const signer = await provider.getSigner();
 const account = await signer.getAddress();
 $('connect').textContent = `${account.slice(0,6)}…${account.slice(-4)}`;
 return {provider, signer, account, epoch: walletEpoch};
}
async function assertWallet(w) {
 const accounts = await window.ethereum.request({method:'eth_accounts'});
 const chain = await window.ethereum.request({method:'eth_chainId'});
 if (walletEpoch !== w.epoch || chain !== '0x2105' || accounts[0]?.toLowerCase() !== w.account.toLowerCase()) throw new Error('钱包账户或网络已改变，请重新提交。');
}
function txLink(label, hash) {
 const a = document.createElement('a'); a.href = `https://basescan.org/tx/${hash}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `${label}：${hash}`; $('transactions').append(a);
}
async function confirmed(tx) {
 const receipt = await tx.wait();
 if (!receipt || receipt.status !== 1) throw new Error('交易未成功确认，请查看区块浏览器。');
}
async function submit(event) {
 event.preventDefault(); if (purchasing) return;
 purchasing = true; $('submit').disabled = true;
 const fields = ['m1','m2','m3','m4','m5','bonus']; fields.forEach(id => $(id).disabled = true);
 $('transactions').replaceChildren();
 try {
  const normals = fields.slice(0,5).map(id => Number($(id).value));
  const bonus = Number($('bonus').value);
  // Reject malformed input before asking for wallet access.
  validateTicket(normals, bonus, 255);
  status('ticketStatus', '连接钱包并检查当期状态…');
  const w = await connect();
  const c = new ethers.Contract(ADDRESS, ABI, w.signer);
  const initial = await snapshot(c); showCurrent(initial);
  const ticket = validateTicket(normals, bonus, Number(initial.state.bonusballMax), Number(initial.state.ballMax));
  async function checkRound() {
   await assertWallet(w);
   const now = await snapshot(c);
   if (now.id !== initial.id || now.state.ticketPrice !== initial.state.ticketPrice) throw new Error('期号或票价已改变，请检查最新状态后重新提交。');
   const [enabled, emergency] = await Promise.all([c.allowTicketPurchases(), c.emergencyMode()]);
   if (!enabled || emergency || now.state.jackpotLock || now.state.prizePool === 0n || now.state.winningTicket !== 0n) throw new Error('当前期暂停销售或正在开奖，请稍后重试。');
   validateTicket(normals, bonus, Number(now.state.bonusballMax), Number(now.state.ballMax));
  }
  await checkRound();
  const token = new ethers.Contract(await c.usdc(), TOKEN_ABI, w.signer);
  const [decimals, symbol, balance, allowance] = await Promise.all([token.decimals(),token.symbol(),token.balanceOf(w.account),token.allowance(w.account, ADDRESS)]);
  if (decimals !== 6n || symbol !== 'USDC') throw new Error('支付代币与预期 USDC 配置不符，已停止提交。');
  const cost = initial.state.ticketPrice;
  if (balance < cost) throw new Error(`USDC 余额不足，本注需要 ${ethers.formatUnits(cost,6)} USDC。`);
  if (allowance < cost) {
   status('ticketStatus', `请在钱包授权本注 ${ethers.formatUnits(cost,6)} USDC…`);
   const approval = await token.approve(ADDRESS, cost); txLink('USDC 授权', approval.hash);
   status('ticketStatus', '授权已提交，等待确认…'); await confirmed(approval);
  }
  await checkRound();
  const args = [[ticket], w.account, [], [], ethers.encodeBytes32String('megapot-manual')];
  status('ticketStatus', '正在模拟购票交易…'); await c.buyTickets.staticCall(...args);
  await assertWallet(w);
  status('ticketStatus', `请在钱包确认购买 1 注（${ethers.formatUnits(cost,6)} USDC）…`);
  const tx = await c.buyTickets(...args); txLink('购票交易', tx.hash);
  status('ticketStatus', '购票交易已提交，等待链上确认…'); await confirmed(tx);
  status('ticketStatus', `购票成功！提交期号 ${initial.id}，主号 ${ticket.normals.join('、')}，Bonus ${bonus}。`, 'success');
  await refresh();
 } catch (e) { status('ticketStatus', errorText(e), 'error'); }
 finally { purchasing = false; $('submit').disabled = false; fields.forEach(id => $(id).disabled = false); }
}
function renderResult(id, state, ticket) {
 const row = document.createElement('div'); row.className = 'result';
 const heading = document.createElement('div'); heading.className = 'result-heading';
 heading.textContent = `第 ${id} 期 · ${new Date(Number(state.drawingTime)*1000).toLocaleString('zh-CN')}（计划开奖）`;
 const balls = document.createElement('div'); balls.className = 'balls';
 [...ticket.normals, ticket.bonusball].forEach((n,i) => { const b = document.createElement('span'); b.className = `ball${i===5?' bonus':''}`; b.textContent = n.toString(); b.title = i===5?'Bonus 号码':'主号码'; balls.append(b); });
 row.append(heading,balls); $('results').append(row);
}
async function history(event) {
 event.preventDefault(); const count = Number($('count').value);
 if (!Number.isInteger(count) || count<1 || count>500) return status('historyStatus','请输入 1–500 的整数。','error');
 $('historyButton').disabled = true; $('results').replaceChildren(); let found = 0;
 try {
  const c = initReader(); const {id: current} = await snapshot(c);
  // Include the current round if settlement finished before the next round opened.
  for (let id = current; id >= 1n && found < count; id--) {
   status('historyStatus', `正在查询第 ${id} 期，已找到 ${found}/${count} 期…`);
   const state = await c.getDrawingState(id);
   if (state.winningTicket === 0n) continue;
   const ticket = await c.getUnpackedTicket(id, state.winningTicket);
   renderResult(id, state, ticket); found++;
  }
  status('historyStatus', found ? `已展示最近 ${found} 期${found<count?'（已到最早可用期数）':''}。` : '暂无已开奖期数。');
 } catch (e) { status('historyStatus', `查询中断，已保留 ${found} 期：${errorText(e)}`, 'error'); }
 finally { $('historyButton').disabled = false; }
}
$('refresh').addEventListener('click',refresh);
$('connect').addEventListener('click',async()=>{ try { await connect(); } catch(e){ status('globalStatus',errorText(e),'error'); } });
$('ticketForm').addEventListener('submit',submit);
$('historyForm').addEventListener('submit',history);
if (window.ethereum?.on) {
 for (const event of ['accountsChanged','chainChanged','disconnect']) window.ethereum.on(event,()=>{ walletEpoch++; $('connect').textContent='重新连接钱包'; });
}
refresh();
