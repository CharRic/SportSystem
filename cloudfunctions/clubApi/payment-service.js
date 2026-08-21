const crypto = require("crypto");
const https = require("https");

const ACTIONS = new Set(["createWechatPayment", "queryWechatPayment"]);

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

function createPaymentService({ businessService }) {
  const config = () => ({ appid: process.env.WECHAT_PAY_APPID || "", mchid: process.env.WECHAT_PAY_MCHID || "", serialNo: process.env.WECHAT_PAY_SERIAL_NO || "", privateKey: String(process.env.WECHAT_PAY_PRIVATE_KEY || "").replace(/\\n/g, "\n"), publicKeyId: process.env.WECHAT_PAY_PUBLIC_KEY_ID || "", publicKey: String(process.env.WECHAT_PAY_PUBLIC_KEY || "").replace(/\\n/g, "\n"), notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || "" });
  const nonce = () => crypto.randomBytes(16).toString("hex");
  const sign = (text, privateKey) => crypto.sign("RSA-SHA256", Buffer.from(text), privateKey).toString("base64");

  async function api(method, path, payload) {
    const cfg = config(); const body = payload ? JSON.stringify(payload) : ""; const timestamp = String(Math.floor(Date.now() / 1000)); const nonceStr = nonce(); const signature = sign(`${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`, cfg.privateKey);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`;
    const response = await request({ hostname: "api.mch.weixin.qq.com", port: 443, path, method, headers: { Accept: "application/json", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: authorization, "User-Agent": "NanlianSportSystem/1.0" } }, body);
    const responseTimestamp = response.headers["wechatpay-timestamp"], responseNonce = response.headers["wechatpay-nonce"], responseSignature = response.headers["wechatpay-signature"], responseSerial = response.headers["wechatpay-serial"];
    if (!responseTimestamp || !responseNonce || !responseSignature || responseSerial !== cfg.publicKeyId || !crypto.verify("RSA-SHA256", Buffer.from(`${responseTimestamp}\n${responseNonce}\n${response.body}\n`), cfg.publicKey, Buffer.from(responseSignature, "base64"))) throw new Error("微信支付应答验签失败");
    let data = {}; try { data = response.body ? JSON.parse(response.body) : {}; } catch (error) { throw new Error("微信支付返回内容无法解析"); }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(data.message || `微信支付接口错误 ${response.statusCode}`);
    return data;
  }

  async function create(user, input, openid) {
    const ready = businessService.paymentReady(); if (!ready.configured) return { configured: false, missing: ready.missing };
    const order = await businessService.payableOrder(user, input.id); if (order.status === "PAID") return { configured: true, alreadyPaid: true };
    if (Number(order.payableAmount || 0) === 0) { await businessService.settleOrder(order._id, { paymentMethod: "COUPON", operatorId: "SYSTEM" }); return { configured: true, freeOrder: true }; }
    const cfg = config(); const result = await api("POST", "/v3/pay/transactions/jsapi", { appid: cfg.appid, mchid: cfg.mchid, description: order.courseTypeName || "俱乐部课程", out_trade_no: order.orderNo, notify_url: cfg.notifyUrl, amount: { total: Number(order.payableAmount), currency: "CNY" }, payer: { openid }, attach: order._id });
    if (!result.prepay_id) throw new Error("微信支付未返回预支付编号"); const timeStamp = String(Math.floor(Date.now() / 1000)); const nonceStr = nonce(); const packageValue = `prepay_id=${result.prepay_id}`; const paySign = sign(`${cfg.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, cfg.privateKey);
    return { configured: true, orderId: order._id, timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign };
  }

  async function query(user, input) {
    const ready = businessService.paymentReady(); if (!ready.configured) return { configured: false, missing: ready.missing }; const order = await businessService.payableOrder(user, input.id); if (order.status === "PAID") return { configured: true, paid: true, tradeState: "SUCCESS" }; const cfg = config(); const result = await api("GET", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.orderNo)}?mchid=${encodeURIComponent(cfg.mchid)}`); const paid = result.trade_state === "SUCCESS"; if (paid) await businessService.settleOrder(order._id, { paymentMethod: "WECHAT_PAY", transactionId: result.transaction_id || "", operatorId: "WECHAT_PAY" }); return { configured: true, paid, tradeState: result.trade_state || "UNKNOWN", tradeStateDesc: result.trade_state_desc || "" };
  }

  async function call(action, input, user, openid) { if (action === "createWechatPayment") return create(user, input, openid); if (action === "queryWechatPayment") return query(user, input); throw new Error("未知支付操作"); }
  return { handles: (action) => ACTIONS.has(action), call };
}

module.exports = { createPaymentService };
