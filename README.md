# Koin

Koin 是一个只供自己使用的本机账单可视化工具。你可以把各平台的原始账单交给 Codex 整理、核对疑问，再把生成的 Koin JSON 导入软件查看。Koin 本身不解析平台账单，也不自动对账。

## 日常使用

1. 每个月（也可以连续两三个月）把账单交给 Codex，确认不清楚的消费、退款和重复流水。
2. 导入 Codex 生成的 JSON。导入前会显示月份范围、新增、重复 ID 和无效记录数量。同 ID 的已有记录保留 Koin 中的修改。
3. 在“概览”查看当月实际消费、收入、退款、分类占比、每日和近 12 个月趋势、商家及标签排行。
4. 在“明细”按日期查看消费，筛选分类、商家、标签，勾选需要的记录查看净消费总和。账单遗漏时可以补记，也可以编辑已有记录。
5. 在“数据”导出当前月份、连续多月或整本账本的 JSON。导出包含补记和修改，重新导入即可恢复。

自然月统计按消费减退款计算；收入单独显示，还款、转账及标记为“不计入”的记录保留在明细中，不计入消费。商品或用途说明有意义时优先显示，商家显示在下一行。

## JSON 格式

新版文件使用 `version: 3` 和 `transactions` 数组。每条记录至少包含稳定的 `id`、`date`（`YYYY-MM-DD`）、`merchant`、正数 `amount` 和 `kind`；`category`、`note`、`tags`、`counted`、`source` 等可按需要填写。`kind` 可为 `expense`、`refund`、`income`、`repayment`、`transfer`。同一笔消费在再次生成的文件中应沿用相同 ID。

```json
{
  "version": 3,
  "transactions": [
    {
      "id": "meituan-2026-09-01-order-123",
      "date": "2026-09-01",
      "merchant": "美团",
      "note": "晚餐",
      "amount": 28,
      "category": "餐饮",
      "tags": ["外卖"],
      "kind": "expense",
      "counted": true
    }
  ]
}
```

旧版 Koin JSON 备份仍可导入。旧记录的关联凭证、待确认及计入状态会原样保留，不重新执行自动对账。轻量版使用新的桌面运行环境，首次运行请导入之前导出的整本账本 JSON；此后仍建议定期导出完整备份。

## 免安装版与开发

Windows 10/11 上可直接运行 `Koin-Portable-0.3.0-x64.exe`，无需安装 Koin。程序使用系统的 WebView2；如果电脑尚未安装 WebView2，需要先安装该运行环境。账本保存在当前 Windows 用户的应用数据中；换电脑时用整本 JSON 备份导入。

从源码构建需要 Node.js 22.13 或更高版本、Rust 和 Windows C++ 构建工具：

```bash
npm ci
npm test
npm run lint
npm run desktop:portable
```

免安装程序位于 `release/`。开发时可运行 `npm run desktop`。如需安装包，可运行 `npm run desktop:installer`。所有数据处理与保存都在当前电脑完成，不需要账号。
