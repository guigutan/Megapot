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
 'function jackpotNFT() view returns (address)',
 'function getTicketTierIds(uint256[]) view returns (uint256[])',
 'function claimWinnings(uint256[] ticketIds)',
 'function buyTickets((uint8[] normals,uint8 bonusball)[] tickets,address recipient,address[] referrers,uint256[] referralSplit,bytes32 source) returns (uint256[])'
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)','function decimals() view returns (uint8)','function symbol() view returns (string)'];
const PAYOUT_ABI = [
 'function getDrawingTierInfo(uint256) view returns ((uint256 minPayout,uint256 premiumTierMinAllocation,bool[12] minPayoutTiers,uint256[12] premiumTierWeights))',
 'function getDrawingTierPayouts(uint256) view returns (uint256[12])'
];
const ONE_E18 = 10n ** 18n;
const NFT_ABI = ['function ownerOf(uint256) view returns (address)', 'function getTicketInfo(uint256) view returns ((uint256 drawingId,uint256 packedTicket,bytes32 referralScheme))'];
let claimBusy = false, winsBusy = false, winsSession = null;
function ticketIdValue(value) {
 if (!/^[0-9]+$/.test(value)) throw new Error('彩票 ID 必须是非负十进制整数。');
 const id = BigInt(value);
 if (id >= 2n ** 256n) throw new Error('彩票 ID 超出范围。');
 return id;
}
function resetWins() {
 winsSession = null; $('wins').replaceChildren(); $('winsMore').hidden = true;
 $('winsAccount').textContent = '请连接钱包后查询。';
}
async function fetchWins(account, cursor) {
 const url = new URL(`https://api.megapot.io/v1/wallets/${account}/wins`);
 url.searchParams.set('claimed', 'false'); url.searchParams.set('limit', '10');
 if (cursor) url.searchParams.set('cursor', cursor);
 const response = await fetch(url, {headers:{Accept:'application/json'}, signal:AbortSignal.timeout(15000)});
 if (!response.ok) throw new Error(response.status === 429 ? '查询频率受限，请稍后重试。' : `中奖查询失败（HTTP ${response.status}），可使用彩票 ID 领取。`);
 const page = await response.json();
 if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean' || (page.has_more && typeof page.next_cursor !== 'string')) throw new Error('中奖接口返回格式异常。');
 return page;
}
function renderWin(win) {
 const id = ticketIdValue(win.user_ticket_id);
 const row = makeNode('div', undefined, 'win-row');
 row.append(makeNode('strong', `第 ${win.round_id} 期 · ${win.matched_normals}+${win.bonusball_match ? 1 : 0}`));
 row.append(makeNode('p', `彩票 ID：${id}`, 'ticket-id'));
 if (win.amount?.decimals === 6 && /^[0-9]+$/.test(win.amount.amount)) row.append(makeNode('p', `索引奖金：${formatScaled(BigInt(win.amount.amount),6)} USDC（领取前核验实际净额）`));
 const button = makeNode('button', '核验并领取'); button.type = 'button';
 button.addEventListener('click', () => claimTicket(id, button, row)); row.append(button); $('wins').append(row);
}
async function queryWins(more = false) {
 if (winsBusy || claimBusy) return;
 winsBusy = true; $('winsQuery').disabled = true; $('winsMore').disabled = true;
 try {
  const w = await connect();
  if (!more) { resetWins(); winsSession = {account:w.account, epoch:w.epoch, cursor:null, seen:new Set()}; }
  const session = winsSession;
  if (!session || session.account.toLowerCase() !== w.account.toLowerCase() || session.epoch !== w.epoch) throw new Error('钱包已改变，请重新查询。');
  $('winsAccount').textContent = `查询钱包：${w.account}`;
  status('claimStatus', '正在查询未领取中奖票…');
  const page = await fetchWins(w.account, session.cursor);
  await assertWallet(w);
  if (winsSession !== session) return;
  for (const win of page.data) {
   if (win.claimed !== false || win.wallet?.toLowerCase() !== w.account.toLowerCase()) continue;
   const id = ticketIdValue(win.user_ticket_id).toString();
   if (!session.seen.has(id)) { renderWin(win); session.seen.add(id); }
  }
  const previous = session.cursor; session.cursor = page.next_cursor;
  $('winsMore').hidden = !page.has_more || session.cursor === previous;
  status('claimStatus', session.seen.size ? `已加载 ${session.seen.size} 张未领取中奖票。索引可能延迟，领取时以链上状态为准。` : '索引暂无未领取中奖票；如刚开奖，可稍后刷新或输入彩票 ID。');
 } catch (e) { status('claimStatus',errorText(e),'error'); }
 finally { winsBusy=false; $('winsQuery').disabled=false; $('winsMore').disabled=false; }
}
async function verifyClaim(c, account, id) {
 const nft = new ethers.Contract(await c.jackpotNFT(), NFT_ABI, c.runner);
 const [owner, info, current] = await Promise.all([nft.ownerOf(id), nft.getTicketInfo(id), c.currentDrawingId()]);
 if (owner.toLowerCase() !== account.toLowerCase()) throw new Error('当前钱包不是这张彩票的持有人。');
 if (info.drawingId >= current) throw new Error('该期尚未完成结算，请稍后领取。');
 const [state, tiers] = await Promise.all([c.getDrawingState(info.drawingId), c.getTicketTierIds([id])]);
 if (state.winningTicket === 0n) throw new Error('该期尚未开奖。');
 const calculator = new ethers.Contract(state.payoutCalculator, PAYOUT_ABI, c.runner);
 const payouts = await calculator.getDrawingTierPayouts(info.drawingId);
 const tier = Number(tiers[0]);
 if (!Number.isInteger(tier) || tier < 0 || tier > 11) throw new Error('链上奖档数据异常。');
 const net = netPayout(payouts[tier], state.referralWinShare);
 if (net <= 0n) throw new Error('该彩票没有可领取奖金。');
 return {round:info.drawingId, tier, net};
}
async function claimTicket(value, button, row) {
 if (claimBusy || winsBusy || purchasing) return;
 claimBusy = true; if (button) button.disabled = true;
 $('winsQuery').disabled=true; $('winsMore').disabled=true; $('manualClaim').disabled=true; $('submit').disabled=true;
 let success = false;
 try {
  const id = ticketIdValue(String(value));
  status('claimStatus','正在核验彩票持有人和链上奖金…');
  const w = await connect(); const c = new ethers.Contract(ADDRESS, ABI, w.signer);
  const verified = await verifyClaim(c, w.account, id);
  await assertWallet(w);
  status('claimStatus',`第 ${verified.round} 期，${Math.floor(verified.tier/2)}+${verified.tier%2}，可领净额 ${formatScaled(verified.net,6)} USDC。正在模拟领取…`);
  await c.claimWinnings.staticCall([id]); await assertWallet(w);
  status('claimStatus',`请在钱包确认领取 ${formatScaled(verified.net,6)} USDC；仅需支付 Base 网络费，无需 USDC 授权。`);
  const tx = await c.claimWinnings([id]);
  const link = makeNode('a',`领取交易：${tx.hash}`); link.href=`https://basescan.org/tx/${tx.hash}`; link.target='_blank'; link.rel='noopener noreferrer'; $('claimTransactions').append(link);
  status('claimStatus','领取交易已提交，等待链上确认…'); await confirmed(tx);
  success = true;
  if (row) row.append(makeNode('p','领取成功','success'));
  status('claimStatus',`领取成功，USDC 已由合约转入钱包 ${w.account}。可重新查询剩余未领取彩票。`,'success');
 } catch(e) { status('claimStatus', `领取失败：${errorText(e)}`,'error'); }
 finally {
  claimBusy=false; if(button) button.disabled=success;
  $('winsQuery').disabled=false; $('winsMore').disabled=false; $('manualClaim').disabled=false; $('submit').disabled=false;
 }
}
function formatScaled(value, decimals) {
 const unit = 10n ** BigInt(decimals);
 const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
 return (value / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
const percent = value => `${formatScaled(value, 16)}%`;
// Match claimWinnings: subtract the rounded-down share, preserving USDC precision.
const netPayout = (gross, share) => gross - gross * share / ONE_E18;
function makeNode(tag, text, className) {
 const node = document.createElement(tag);
 if (text !== undefined) node.textContent = text;
 if (className) node.className = className;
 return node;
}
async function readPastTiers(c, id, state) {
 if (!state.payoutCalculator || /^0x0{40}$/i.test(state.payoutCalculator)) throw new Error('该期未提供奖金计算合约地址。');
 const calculator = new ethers.Contract(state.payoutCalculator, PAYOUT_ABI, c.runner);
 // Read the saved per-round configuration, never today's global weights.
 const [config, payouts] = await Promise.allSettled([
  calculator.getDrawingTierInfo(id), calculator.getDrawingTierPayouts(id)
 ]);
 return {config: config.status === 'fulfilled' ? config.value : null,
  payouts: payouts.status === 'fulfilled' ? payouts.value : null,
  errors: [config, payouts].filter(r => r.status === 'rejected').map(r => errorText(r.reason))};
}
function renderPastTiers(host, state, data) {
 host.replaceChildren();
 const {config, payouts} = data;
 if (data.errors.length) host.append(makeNode('p', `部分奖金数据读取失败：${data.errors.join('；')}`, 'error'));
 if (!config && !payouts) return;
 const share = state.referralWinShare;
 host.append(makeNode('p', `当期奖金池 ${formatScaled(state.prizePool, 6)} USDC · 中奖分成 ${percent(share)}`, 'tier-note'));
 if (config) host.append(makeNode('p', `保底配置：每注 ${formatScaled(config.minPayout, 6)} USDC；高级奖最低预留比例 ${percent(config.premiumTierMinAllocation)}。保底资格不代表本期一定启用保底，最终金额以下表为准。`, 'tier-note'));
 const wrapper = makeNode('div', undefined, 'tier-scroll');
 const table = makeNode('table', undefined, 'tier-table');
 const caption = makeNode('caption', '各档最终每注奖金（USDC）');
 const head = makeNode('thead'); const titles = makeNode('tr');
 for (const title of ['命中情况', '剩余池权重', '保底资格', '每注总额', '每注净额']) {
  const th = makeNode('th', title); th.scope = 'col'; titles.append(th);
 }
 head.append(titles); const body = makeNode('tbody');
 for (let tier = 11; tier >= 0; tier--) {
  const row = makeNode('tr');
  const label = `${Math.floor(tier / 2)}+${tier % 2}`;
  const values = [label, config ? percent(config.premiumTierWeights[tier]) : '未获取',
   config ? (config.minPayoutTiers[tier] ? '有' : '无') : '未获取',
   payouts ? formatScaled(payouts[tier], 6) : '未获取',
   payouts ? formatScaled(netPayout(payouts[tier], share), 6) : '未获取'];
  values.forEach((text, i) => { const cell = makeNode(i === 0 ? 'th' : 'td', text); if (i === 0) cell.scope = 'row'; row.append(cell); });
  body.append(row);
 }
 table.append(caption, head, body); wrapper.append(table); host.append(wrapper);
 host.append(makeNode('p', '权重针对扣除保底后的剩余奖金池，不是整个奖金池占比。总额取自该期最终结算；净额扣除当期中奖分成，未扣网络费。每注金额不代表该档实际有玩家中奖。', 'tier-note'));
 const source = makeNode('a', '查看该期奖金计算合约 ↗');
 source.href = `https://basescan.org/address/${state.payoutCalculator}#readContract`;
 source.target = '_blank'; source.rel = 'noopener noreferrer'; host.append(source);
}
async function loadPastTiers(c, id, state, host) {
 host.replaceChildren(makeNode('p', '正在读取该期各档权重与最终奖金…'));
 try { renderPastTiers(host, state, await readPastTiers(c, id, state)); }
 catch (e) { host.replaceChildren(makeNode('p', `奖金数据读取失败：${errorText(e)}`, 'error')); }
 const retry = makeNode('button', '重新读取奖金', 'secondary'); retry.type = 'button';
 retry.addEventListener('click', () => loadPastTiers(c, id, state, host)); host.append(retry);
}
const $ = id => document.getElementById(id);
let reader, readContract, walletEpoch = 0, purchasing = false;
let currentDrawingState;
function countdownText(state, now = Date.now()) {
 if (!state || Number(state.drawingTime) <= 0) return '—';
 if (state.winningTicket !== 0n) return '本期已开奖';
 if (state.jackpotLock) return '开奖处理中';
 const seconds = Math.max(0, Math.ceil(Number(state.drawingTime) - now / 1000));
 if (seconds === 0) return '等待链上开奖';
 const days = Math.floor(seconds / 86400);
 const hours = Math.floor(seconds % 86400 / 3600);
 const minutes = Math.floor(seconds % 3600 / 60);
 const pad = n => String(n).padStart(2, '0');
 return `${days ? days + '天 ' : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`;
}
function updateCountdown() {
 $('countdown').textContent = countdownText(currentDrawingState);
}
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
 currentDrawingState = state;
 const [whole, fraction] = ethers.formatUnits(state.prizePool, 6).split('.');
 $('prizePool').textContent = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction && /[1-9]/.test(fraction) ? `.${fraction}` : '');
 $('drawingAt').textContent = Number(state.drawingTime) > 0
  ? `计划开奖：${new Date(Number(state.drawingTime) * 1000).toLocaleString('zh-CN', {timeZoneName:'short'})}`
  : '计划开奖时间 —';
 updateCountdown();
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
 event.preventDefault(); if (purchasing || claimBusy) return;
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
 const details = makeNode('details', undefined, 'tier-details');
 details.append(makeNode('summary', '各档权重与最终奖金'));
 const host = makeNode('div'); details.append(host);
 row.append(heading,balls,details); $('results').append(row);
 return host;
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
   const host = renderResult(id, state, ticket); found++;
   await loadPastTiers(c, id, state, host);
  }
  status('historyStatus', found ? `已展示最近 ${found} 期${found<count?'（已到最早可用期数）':''}。` : '暂无已开奖期数。');
 } catch (e) { status('historyStatus', `查询中断，已保留 ${found} 期：${errorText(e)}`, 'error'); }
 finally { $('historyButton').disabled = false; }
}
$('refresh').addEventListener('click',refresh);
$('connect').addEventListener('click',async()=>{ try { await connect(); } catch(e){ status('globalStatus',errorText(e),'error'); } });
$('ticketForm').addEventListener('submit',submit);
$('historyForm').addEventListener('submit',history);
$('winsQuery').addEventListener('click',()=>queryWins());
$('winsMore').addEventListener('click',()=>queryWins(true));
$('claimForm').addEventListener('submit',event=>{event.preventDefault();claimTicket($('claimTicketId').value.trim(),$('manualClaim'));});
if (window.ethereum?.on) {
 for (const event of ['accountsChanged','chainChanged','disconnect']) window.ethereum.on(event,()=>{ walletEpoch++; resetWins(); $('connect').textContent='重新连接钱包'; });
}
refresh();
window.setInterval(updateCountdown, 1000);
