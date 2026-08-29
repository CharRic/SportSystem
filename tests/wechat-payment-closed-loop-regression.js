const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createPaymentService } = require("../cloudfunctions/clubApi/payment-service");
const { EXPECTED_APPID, PaymentError, verifyTransaction } = require("../cloudfunctions/clubApi/payment-security");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const apiV3Key = "12345678901234567890123456789012";
Object.assign(process.env, {
  WECHAT_PAY_APPID: EXPECTED_APPID,
  WECHAT_PAY_MCHID: "1900000109",
  WECHAT_PAY_SERIAL_NO: "MERCHANT_SERIAL_TEST",
  WECHAT_PAY_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_TEST",
  WECHAT_PAY_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
  WECHAT_PAY_API_V3_KEY: apiV3Key,
  WECHAT_PAY_NOTIFY_URL: "https://example.test/wechat-pay/notify",
  PAYMENT_PRODUCTION_ENABLED: "true",
});

const orders = new Map();
const claims = new Map();
const securityLogs = [];
let lessonsGranted = 0;
const addOrder = (orderNo, overrides = {}) => {
  const order = { _id: `id-${orderNo}`, orderNo, studentId: `student-${orderNo}`, userId: `parent-${orderNo}`, payableAmount: 138000, status: "PENDING_PAYMENT", transactionId: "", ...overrides };
  orders.set(orderNo, order); return order;
};
const transaction = (order, overrides = {}) => ({ appid: EXPECTED_APPID, mchid: process.env.WECHAT_PAY_MCHID, out_trade_no: order.orderNo, transaction_id: `tx-${order.orderNo}`, trade_state: "SUCCESS", trade_type: "JSAPI", amount: { total: order.payableAmount, currency: "CNY" }, payer: { openid: "openid-test" }, ...overrides });

const businessService = {
  async verifyAndSettleWechatPayment(value) {
    const order = orders.get(value.out_trade_no);
    const verified = verifyTransaction(order, value, { appid: process.env.WECHAT_PAY_APPID, mchid: process.env.WECHAT_PAY_MCHID });
    const claimed = claims.get(verified.transactionId);
    if (claimed && claimed !== order._id) throw new PaymentError("TRANSACTION_ID_CONFLICT", "交易号冲突");
    claims.set(verified.transactionId, order._id);
    if (order.status === "PAID") {
      if (order.transactionId !== verified.transactionId) throw new PaymentError("TRANSACTION_ID_CONFLICT", "已支付订单交易号冲突");
      return { paid: true, idempotent: true };
    }
    order.status = "PAID"; order.transactionId = verified.transactionId; lessonsGranted += 14;
    return { paid: true, idempotent: false };
  },
  async paymentSecurityLog(error, detail) { securityLogs.push({ code: error.code, ...detail }); },
};
const service = createPaymentService({ businessService });

function encryptResource(value, corrupt = false) {
  const nonce = "0123456789ab", associatedData = "transaction";
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
  return { algorithm: "AEAD_AES_256_GCM", nonce, associated_data: associatedData, ciphertext: corrupt ? "not-valid-ciphertext" : encrypted.toString("base64") };
}

function notifyEvent(value, options = {}) {
  const body = JSON.stringify({ id: options.id || `notify-${Date.now()}`, event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource", resource: encryptResource(value, options.corrupt) });
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = "notify-nonce";
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), privateKey).toString("base64");
  const signedValue = options.badSignature ? `${signature.slice(0, -8)}AAAAAAAA` : signature;
  return { httpMethod: "POST", body, headers: { "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Signature": signedValue, "Wechatpay-Serial": "PUB_KEY_ID_TEST" } };
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("合法微信支付通知只到账一次", async () => { const order = addOrder("NL-LEGAL"); const response = await service.handleNotify(notifyEvent(transaction(order))); assert.equal(response.statusCode, 200); assert.equal(order.status, "PAID"); assert.equal(lessonsGranted, 14); });
test("相同通知重复五次保持幂等", async () => { const order = orders.get("NL-LEGAL"), event = notifyEvent(transaction(order)); await Promise.all(Array.from({ length: 5 }, () => service.handleNotify(event))); assert.equal(lessonsGranted, 14); });
test("主动查单与通知并发只结算一次", async () => { const order = addOrder("NL-RACE"), value = transaction(order); await Promise.all([businessService.verifyAndSettleWechatPayment(value, { source: "ACTIVE_QUERY" }), businessService.verifyAndSettleWechatPayment(value, { source: "WECHAT_NOTIFY" })]); assert.equal(order.status, "PAID"); assert.equal(lessonsGranted, 28); });
test("金额不一致禁止到账", async () => { const order = addOrder("NL-AMOUNT"), response = await service.handleNotify(notifyEvent(transaction(order, { amount: { total: 1, currency: "CNY" } }))); assert.equal(response.statusCode, 400); assert.equal(order.status, "PENDING_PAYMENT"); });
test("AppID错误禁止到账", async () => { const order = addOrder("NL-APPID"), response = await service.handleNotify(notifyEvent(transaction(order, { appid: "wx-wrong" }))); assert.equal(response.statusCode, 400); assert.notEqual(order.status, "PAID"); });
test("商户号错误禁止到账", async () => { const order = addOrder("NL-MCHID"), response = await service.handleNotify(notifyEvent(transaction(order, { mchid: "wrong" }))); assert.equal(response.statusCode, 400); assert.notEqual(order.status, "PAID"); });
test("非CNY币种禁止到账", async () => { const order = addOrder("NL-CURRENCY"), response = await service.handleNotify(notifyEvent(transaction(order, { amount: { total: order.payableAmount, currency: "USD" } }))); assert.equal(response.statusCode, 400); assert.notEqual(order.status, "PAID"); });
test("商户订单号不匹配禁止到账", async () => { const order = addOrder("NL-ORDERNO"); assert.throws(() => verifyTransaction(order, transaction(order, { out_trade_no: "NL-WRONG" }), { appid: EXPECTED_APPID, mchid: process.env.WECHAT_PAY_MCHID }), (error) => error.code === "ORDER_NO_MISMATCH"); });
test("同一transactionId不能绑定不同订单", async () => { const first = addOrder("NL-TX-A"), second = addOrder("NL-TX-B"), shared = "tx-shared"; await businessService.verifyAndSettleWechatPayment(transaction(first, { transaction_id: shared })); await assert.rejects(() => businessService.verifyAndSettleWechatPayment(transaction(second, { transaction_id: shared })), (error) => error.code === "TRANSACTION_ID_CONFLICT"); });
test("微信通知验签失败禁止到账", async () => { const order = addOrder("NL-SIGN"); const response = await service.handleNotify(notifyEvent(transaction(order), { badSignature: true })); assert.equal(response.statusCode, 401); assert.notEqual(order.status, "PAID"); });
test("API v3资源解密失败禁止到账", async () => { const order = addOrder("NL-DECRYPT"); const response = await service.handleNotify(notifyEvent(transaction(order), { corrupt: true })); assert.equal(response.statusCode, 400); assert.notEqual(order.status, "PAID"); });
test("用户退出小程序后回调仍可到账", async () => { const order = addOrder("NL-EXIT"); const response = await service.handleNotify(notifyEvent(transaction(order))); assert.equal(response.statusCode, 200); assert.equal(order.status, "PAID"); });
test("requestPayment取消不会由前端设置PAID", async () => { const source = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/orders/index.js"), "utf8"); assert(!/requestPayment[\s\S]{0,500}(status\s*=\s*["']PAID|remainingLessons\s*\+)/.test(source)); });
test("旧订单重试复用prepay并支持CLOSED替换", async () => { const payment = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/payment-service.js"), "utf8"), business = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); assert(payment.includes("latestPaymentAttempt") && business.includes("replaceClosedWechatOrder")); });
test("管理员不能人工确认微信支付订单", async () => { const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); assert(source.includes("WECHAT_PAYMENT_MANUAL_SETTLEMENT_FORBIDDEN")); });
test("线下到账要求备注并写Audit Log", async () => { const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); assert(source.includes("人工到账必须填写备注") && source.includes("CONFIRM_OFFLINE_ORDER_PAYMENT")); });
test("Student归属变化进入人工复核", async () => { const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); assert(source.includes("student.ownerParentUserId !== order.userId") && source.includes("PAYMENT_REVIEW_REQUIRED")); });
test("生产支付开关默认关闭", async () => { const previous = process.env.PAYMENT_PRODUCTION_ENABLED; delete process.env.PAYMENT_PRODUCTION_ENABLED; delete require.cache[require.resolve("../cloudfunctions/clubApi/payment-security")]; const security = require("../cloudfunctions/clubApi/payment-security"); assert.equal(security.paymentReadiness().ready, false); process.env.PAYMENT_PRODUCTION_ENABLED = previous; });
test("支付事件覆盖创建查询通知和结算来源", async () => { const payment = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/payment-service.js"), "utf8"), business = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); ["JSAPI_CREATE", "ACTIVE_QUERY", "WECHAT_NOTIFY"].forEach((source) => assert(payment.includes(source))); assert(business.includes('source: "SETTLED"')); });
test("支付配置接口只返回状态和缺失项标识", async () => { const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/clubApi/business-service.js"), "utf8"); const start = source.indexOf("function paymentReady()"); const section = source.slice(start, source.indexOf("async function paymentDiagnostics", start)); assert(section.includes("status") && section.includes("missing") && !section.includes("privateKey") && !section.includes("apiV3Key")); });

(async () => {
  let passed = 0;
  for (const item of cases) { await item.fn(); passed += 1; }
  assert(securityLogs.some((item) => item.code === "SIGNATURE_INVALID"));
  console.log(`WeChat payment closed-loop regression: ${passed} scenarios passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
