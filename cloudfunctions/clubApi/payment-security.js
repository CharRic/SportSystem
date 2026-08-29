const crypto = require("crypto");

const EXPECTED_APPID = "wx6082ff5e4a142c74";

class PaymentError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.httpStatus = options.httpStatus || 400;
    this.safeMessage = options.safeMessage || "支付确认异常，请联系俱乐部工作人员。";
  }
}

function fail(code, message, options) { throw new PaymentError(code, message, options); }

function normalizeHeaders(headers = {}) {
  return Object.keys(headers || {}).reduce((result, key) => {
    result[String(key).toLowerCase()] = headers[key];
    return result;
  }, {});
}

function rawEventBody(event = {}) {
  if (Buffer.isBuffer(event.body)) return event.body.toString("utf8");
  if (typeof event.body === "string") return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (event.body && typeof event.body === "object") return JSON.stringify(event.body);
  return "";
}

function verificationKeyForSerial(serial, options = {}) {
  const keys = options.verificationKeys || {};
  if (keys[serial]) return keys[serial];
  if (options.publicKey && (!options.publicKeyId || options.publicKeyId === serial)) return options.publicKey;
  fail("SIGNATURE_INVALID", "未配置该Wechatpay-Serial对应的验签公钥", { httpStatus: 401 });
}

function verifyWechatpaySignature({ headers, body, publicKey, publicKeyId, verificationKeys, now = Date.now(), toleranceSeconds = 300 }) {
  const value = normalizeHeaders(headers);
  const timestamp = String(value["wechatpay-timestamp"] || "");
  const nonce = String(value["wechatpay-nonce"] || "");
  const signature = String(value["wechatpay-signature"] || "");
  const serial = String(value["wechatpay-serial"] || "");
  if (!timestamp || !nonce || !signature || !serial) fail("SIGNATURE_INVALID", "微信支付通知签名头不完整", { httpStatus: 401 });
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Math.floor(now / 1000) - timestampNumber) > toleranceSeconds) fail("SIGNATURE_INVALID", "微信支付通知时间戳无效", { httpStatus: 401 });
  let valid = false;
  try {
    const selectedKey = verificationKeyForSerial(serial, { publicKey, publicKeyId, verificationKeys });
    valid = crypto.verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), selectedKey, Buffer.from(signature, "base64"));
  } catch (error) {
    fail("SIGNATURE_INVALID", "微信支付通知验签执行失败", { httpStatus: 401 });
  }
  if (!valid) fail("SIGNATURE_INVALID", "微信支付通知验签失败", { httpStatus: 401 });
  return { timestamp, nonce, serial };
}

function decryptWechatpayResource(resource, apiV3Key) {
  if (!resource || resource.algorithm !== "AEAD_AES_256_GCM") fail("DECRYPT_FAILED", "微信支付通知资源算法不受支持");
  const key = Buffer.from(String(apiV3Key || ""), "utf8");
  if (key.length !== 32) fail("DECRYPT_FAILED", "微信支付API v3 Key长度无效");
  try {
    const encrypted = Buffer.from(String(resource.ciphertext || ""), "base64");
    if (encrypted.length <= 16) fail("DECRYPT_FAILED", "微信支付通知密文无效");
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const authTag = encrypted.subarray(encrypted.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(resource.nonce || ""), "utf8"));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(String(resource.associated_data || ""), "utf8"));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext);
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    fail("DECRYPT_FAILED", "微信支付通知资源解密失败");
  }
}

function verifyTransaction(order, transaction, config) {
  if (!order) fail("ORDER_NOT_FOUND", "支付订单不存在");
  if (!transaction || typeof transaction !== "object") fail("TRADE_STATE_NOT_SUCCESS", "微信支付交易数据不存在");
  if (transaction.appid !== config.appid) fail("APPID_MISMATCH", "支付交易AppID不匹配");
  if (transaction.mchid !== config.mchid) fail("MCHID_MISMATCH", "支付交易商户号不匹配");
  if (transaction.out_trade_no !== order.orderNo) fail("ORDER_NO_MISMATCH", "支付交易商户订单号不匹配");
  if (!transaction.transaction_id) fail("TRANSACTION_ID_CONFLICT", "微信支付交易号缺失");
  if (transaction.trade_state !== "SUCCESS") fail("TRADE_STATE_NOT_SUCCESS", "微信支付交易尚未成功", { safeMessage: "支付状态确认中，请稍后刷新。" });
  if (transaction.trade_type !== "JSAPI") fail("TRADE_TYPE_MISMATCH", "微信支付交易类型不匹配");
  if (!transaction.amount || Number(transaction.amount.total) !== Number(order.payableAmount)) fail("AMOUNT_MISMATCH", "微信支付交易金额不匹配");
  if (transaction.amount.currency !== "CNY") fail("CURRENCY_MISMATCH", "微信支付交易币种不匹配");
  return {
    transactionId: transaction.transaction_id,
    amountFen: Number(transaction.amount.total),
    currency: transaction.amount.currency,
    payerOpenid: String(((transaction.payer || {}).openid) || ""),
    successTime: String(transaction.success_time || ""),
    tradeType: transaction.trade_type,
  };
}

function paymentConfig(env = process.env) {
  const publicKeyId = String(env.WECHAT_PAY_PUBLIC_KEY_ID || "");
  const publicKey = String(env.WECHAT_PAY_PUBLIC_KEY || "").replace(/\\n/g, "\n");
  const verificationKeys = {};
  let verificationKeysValid = true;
  if (publicKeyId && publicKey) verificationKeys[publicKeyId] = publicKey;
  if (env.WECHAT_PAY_VERIFICATION_KEYS_JSON) {
    try {
      const extra = JSON.parse(String(env.WECHAT_PAY_VERIFICATION_KEYS_JSON));
      if (!extra || Array.isArray(extra) || typeof extra !== "object") throw new Error("invalid map");
      Object.keys(extra).forEach((serial) => {
        const pem = String(extra[serial] || "").replace(/\\n/g, "\n");
        if (!serial || !pem) throw new Error("invalid key");
        verificationKeys[serial] = pem;
      });
    } catch (error) {
      verificationKeysValid = false;
    }
  }
  return {
    appid: String(env.WECHAT_PAY_APPID || ""),
    mchid: String(env.WECHAT_PAY_MCHID || ""),
    serialNo: String(env.WECHAT_PAY_SERIAL_NO || ""),
    privateKey: String(env.WECHAT_PAY_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    publicKeyId,
    publicKey,
    verificationKeys,
    verificationKeysValid,
    apiV3Key: String(env.WECHAT_PAY_API_V3_KEY || ""),
    notifyUrl: String(env.WECHAT_PAY_NOTIFY_URL || ""),
    productionEnabled: String(env.PAYMENT_PRODUCTION_ENABLED || "").toLowerCase() === "true",
  };
}

function paymentEnvironmentCheck(env = process.env) {
  const config = paymentConfig(env);
  const fields = {
    WECHAT_PAY_APPID: Boolean(config.appid),
    WECHAT_PAY_MCHID: Boolean(config.mchid),
    WECHAT_PAY_PRIVATE_KEY: Boolean(config.privateKey),
    WECHAT_PAY_SERIAL_NO: Boolean(config.serialNo),
    WECHAT_PAY_PUBLIC_KEY_ID: Boolean(config.publicKeyId),
    WECHAT_PAY_PUBLIC_KEY: Boolean(config.publicKey),
    WECHAT_PAY_API_V3_KEY: Boolean(config.apiV3Key),
    WECHAT_PAY_NOTIFY_URL: Boolean(config.notifyUrl),
    PAYMENT_PRODUCTION_ENABLED: Object.prototype.hasOwnProperty.call(env, "PAYMENT_PRODUCTION_ENABLED") && ["true", "false"].includes(String(env.PAYMENT_PRODUCTION_ENABLED).toLowerCase()),
  };
  const missing = Object.keys(fields).filter((key) => !fields[key]);
  if (!config.verificationKeysValid) missing.push("WECHAT_PAY_VERIFICATION_KEYS_JSON_INVALID");
  const appIdMatches = config.appid === EXPECTED_APPID;
  if (config.appid && !appIdMatches) missing.push("WECHAT_PAY_APPID_MISMATCH");
  return {
    status: missing.length ? "NOT_READY" : "READY",
    missing,
  };
}

function paymentReadiness(env = process.env) {
  const config = paymentConfig(env);
  const environment = paymentEnvironmentCheck(env);
  const configured = environment.status === "READY";
  const appIdMatches = config.appid === EXPECTED_APPID;
  return {
    config,
    configured,
    appIdMatches,
    productionEnabled: config.productionEnabled,
    ready: configured && config.productionEnabled,
    status: environment.status,
    environment,
  };
}

module.exports = {
  EXPECTED_APPID,
  PaymentError,
  normalizeHeaders,
  rawEventBody,
  verificationKeyForSerial,
  verifyWechatpaySignature,
  decryptWechatpayResource,
  verifyTransaction,
  paymentConfig,
  paymentEnvironmentCheck,
  paymentReadiness,
};
