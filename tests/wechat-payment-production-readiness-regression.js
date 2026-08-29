const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EXPECTED_APPID, paymentEnvironmentCheck, paymentReadiness, verifyWechatpaySignature } = require("../cloudfunctions/clubApi/payment-security");
const { NOTIFY_PATH, createPaymentService } = require("../cloudfunctions/clubApi/payment-service");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
const check = (value, message) => { assert(value, message); passed += 1; };

const readyEnv = {
  WECHAT_PAY_APPID: EXPECTED_APPID,
  WECHAT_PAY_MCHID: "1900000109",
  WECHAT_PAY_PRIVATE_KEY: "merchant-private-key-placeholder",
  WECHAT_PAY_SERIAL_NO: "merchant-serial",
  WECHAT_PAY_PUBLIC_KEY_ID: "PUB_KEY_ID_PRIMARY",
  WECHAT_PAY_PUBLIC_KEY: "wechat-public-key-placeholder",
  WECHAT_PAY_API_V3_KEY: "12345678901234567890123456789012",
  WECHAT_PAY_NOTIFY_URL: "https://example.test/wechat-pay/notify",
  PAYMENT_PRODUCTION_ENABLED: "false",
};
const environment = paymentEnvironmentCheck(readyEnv);
check(environment.status === "READY" && paymentReadiness(readyEnv).ready === false, "配置就绪不能自动开启生产支付");
check(!JSON.stringify(environment).includes("merchant-private-key-placeholder") && !JSON.stringify(environment).includes(readyEnv.WECHAT_PAY_API_V3_KEY), "环境检查不得返回密钥值");
const incomplete = paymentEnvironmentCheck({ WECHAT_PAY_APPID: EXPECTED_APPID });
check(incomplete.status === "NOT_READY" && incomplete.missing.includes("WECHAT_PAY_MCHID"), "缺失配置必须返回非敏感标识");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const timestamp = String(Math.floor(Date.now() / 1000)), nonce = "rotation-test", body = "{}", platformSerial = "42A1PLATFORMCERT";
const signature = crypto.sign("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), privateKey).toString("base64");
const verified = verifyWechatpaySignature({ headers: { "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Signature": signature, "Wechatpay-Serial": platformSerial }, body, verificationKeys: { [platformSerial]: publicKey.export({ type: "spki", format: "pem" }) } });
check(verified.serial === platformSerial, "Wechatpay-Serial必须支持平台证书序列号而非仅PUB_KEY_ID");

const service = createPaymentService({ businessService: {} });
check(service.isHttpNotifyEvent({ httpMethod: "POST", path: NOTIFY_PATH }) && !service.isHttpNotifyEvent({ httpMethod: "POST", path: "/other" }), "公网入口必须限制固定POST回调路径");

const business = read("cloudfunctions/clubApi/business-service.js");
check(business.includes('packageCode: "PAYMENT_TEST_1"') && business.includes('priceFen: 100') && business.includes('status: "INACTIVE"'), "1元测试套餐必须默认停用");
check(business.includes('"checkPaymentAcceptance"') && business.includes("A_ORDER_PAID") && business.includes("G_AUDIT_LOG"), "必须提供A-G只读验收检查器");
const checkerStart = business.indexOf("async function paymentAcceptanceCheck");
const checkerEnd = business.indexOf("async function listNotifications", checkerStart);
const checker = business.slice(checkerStart, checkerEnd);
check(!checker.includes(".add(") && !checker.includes(".update(") && !checker.includes(".remove("), "验收检查器不得自动修复数据");

const page = read("miniprogram/pages/payment-diagnostics/index.wxml");
check(page.includes("生产支付开关") && page.includes("微信支付配置") && page.includes("运行真实支付验收检查"), "ADMIN支付诊断页面必须完整");

for (const collection of ["orders", "payments", "paymentTransactionClaims", "lessonEntitlements", "lessonEntitlementEvents", "lessonLedger"]) {
  const rule = JSON.parse(read(`cloudbase/database-rules/${collection}.json`));
  assert.strictEqual(rule.read, false); assert.strictEqual(rule.write, false); passed += 1;
}

console.log(`WeChat payment production readiness regression: ${passed} checks passed`);
