# Megapot 自选彩票前端

静态 HTML/CSS/JavaScript，使用 ethers v6 和 Base 主网合约。

## 运行

在项目目录执行 `python -m http.server 8080`，然后访问 http://localhost:8080 。无需构建。ethers 从 jsDelivr 加载，链上读取使用 https://mainnet.base.org （公共 RPC 可能限流；可在 app.js 修改 RPC）。

## 功能

- 免连接钱包刷新当期期号、Bonus 上限、USDC 票价。
- 输入最近 X 期（1–500），逐期倒序查询已结算结果，使用 `getUnpackedTicket` 解码；未开奖期跳过。时间标为计划开奖时间。部分 RPC 失败保留已加载结果。
- 手动输入 5 个不重复的 1–30 整数和动态范围内的 Bonus 整数，每次购买 1 注。
- 连接兼容 EIP-1193 的浏览器钱包并切换 Base。读取合约 USDC 地址、余额和 allowance；不足时仅授权本注票价；模拟成功后请求购票签名。无推荐人分成。
- 购票前重新检查销售开关、紧急模式、当期锁定、号码范围、钱包网络和账户；授权期间期号或票价变化会停止，需重新提交。
- 展示授权与购票交易链接及确认状态。

## 接口依据

采用官方参考实现的部署地址、当期状态 tuple 和购票签名：

- https://github.com/coordinationlabs/megapot-starter-kit/blob/main/src/config/contracts.ts
- https://github.com/coordinationlabs/megapot-starter-kit/blob/main/src/hooks/useJackpotState.ts
- https://github.com/coordinationlabs/megapot-starter-kit/blob/main/src/hooks/useBuyTickets.ts
- https://basescan.org/address/0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2#code

读取：`currentDrawingId`、`getDrawingState`、`getUnpackedTicket`。写入：`buyTickets((uint8[] normals,uint8 bonusball)[],address,address[],uint256[],bytes32)`，支付 USDC（6 位小数）。替换原页面中无依据的 `getCurrentBonusMax` 与 `buyTicket`。

`buyTickets` 本身不带期号约束，因此签名后到打包前跨期仍可能买入下一期，最终以链上交易事件为准。

## 检查

`node --check app.js`

`node --test tests/app.test.cjs`

测试覆盖号码校验与历史查询排序、跳过未开奖和部分失败保留。不包含真实钱包签名、实际购票或实时 RPC 集成验证。

## 历史各档奖金

查询历史开奖时自动读取每期 `state.payoutCalculator`，调用 `getDrawingTierInfo(id)` 获取该期冻结的保底配置和各档剩余池权重，以及 `getDrawingTierPayouts(id)` 获取最终每注奖金。展开每期“各档权重与最终奖金”查看全部 12 个档位。

净额按合约领取逻辑计算：`gross - floor(gross * referralWinShare / 1e18)`，保留 USDC 最小单位精度。该分成仍适用于没有推荐人的彩票；无推荐人时分成去向为 LP。表中的每注金额不代表该档实际有玩家中奖。保底资格仅表示配置，不宣称当期结算一定启用保底。

权重和最终奖金分别读取，一项失败不影响另一项展示；失败值显示未获取，支持逐期重试，不会当成 0。某期读取失败不会中断后续期数查询。

接口参考：https://github.com/code-423n4/2025-11-megapot/blob/main/contracts/GuaranteedMinimumPayoutCalculator.sol 。未完成实时 RPC 集成验证。
