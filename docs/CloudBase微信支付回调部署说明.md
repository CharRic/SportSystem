# CloudBase 微信支付回调部署说明

## 推荐方式

使用 CloudBase「HTTP 访问服务 / HTTP 网关」将现有 `clubApi` 云函数映射为公网 HTTPS 路由，不需要另建支付云函数或云托管服务。

路由配置：

- 目标云函数：`clubApi`
- 请求方法：`POST`
- 路由：`/wechat-pay/notify`
- 身份认证：关闭（微信支付服务器没有小程序登录态）
- 公网协议：HTTPS

默认域名结构：

```text
https://cloud1-d2g4gi77g48dcee01.<实际环境地域>.app.tcloudbase.com/wechat-pay/notify
```

若绑定已备案自定义域名，则使用：

```text
https://<支付回调域名>/wechat-pay/notify
```

最终完整地址写入云函数环境变量 `WECHAT_PAY_NOTIFY_URL`，并保证与微信支付 JSAPI 下单请求中的 `notify_url` 完全一致。

## 安全边界

该路由不能依赖 `wx.login`、openid、前端 token 或小程序会话。入口仅接受固定路径的 POST 请求，业务安全由以下校验保证：

- `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Signature`、`Wechatpay-Serial` 完整；
- 根据 `Wechatpay-Serial` 选择对应微信支付公钥或平台证书公钥；
- API v3 Key 解密通知资源；
- 校验 AppID、商户号、订单号、金额、币种、交易类型和交易状态；
- 交易号唯一占用与结算幂等。

## 公钥轮换

主验签公钥继续配置：

- `WECHAT_PAY_PUBLIC_KEY_ID`
- `WECHAT_PAY_PUBLIC_KEY`

灰度切换或同时兼容平台证书时，可额外配置 `WECHAT_PAY_VERIFICATION_KEYS_JSON`，其内容为 `Wechatpay-Serial` 到 PEM 公钥的 JSON 映射。该字段属于密钥配置，不得打印或提交到代码仓库。

## 上线前检查

1. 部署 `clubApi` 最新代码。
2. 配置全部支付环境变量，但保持 `PAYMENT_PRODUCTION_ENABLED=false`。
3. 创建 HTTP 访问路由并等待域名映射生效。
4. 用公网请求确认该地址可访问；非微信签名请求返回 401/400 属于预期，不能返回 404。
5. 在 CloudBase 数据库控制台逐个应用 `cloudbase/database-rules/` 下的支付集合规则。
6. 管理员进入“运营驾驶舱 → 微信支付状态”，确认配置项状态。
7. 只有在人工复核商户配置、回调和数据库规则后，才允许单独将生产开关改为 `true`，启用1元套餐并执行真实付款。
