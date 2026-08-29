# 支付关键集合安全规则

以下规则必须在正式 CloudBase 环境逐个应用到同名集合：

- `orders`
- `payments`
- `paymentTransactionClaims`
- `lessonEntitlements`
- `lessonEntitlementEvents`
- `lessonLedger`

规则统一为：

```json
{
  "read": false,
  "write": false
}
```

这会禁止小程序客户端直接读取、创建、修改或删除支付关键数据；云函数 `clubApi` 使用服务端权限访问，不受客户端安全规则影响。正式上线前必须在 CloudBase 控制台核对规则已经生效，不能仅以仓库文件存在作为已部署依据。
