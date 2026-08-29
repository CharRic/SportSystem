const crypto = require("crypto");
const https = require("https");
const { PaymentError, normalizeHeaders, rawEventBody, verificationKeyForSerial, verifyWechatpaySignature, decryptWechatpayResource, paymentReadiness } = require("./payment-security");

const NOTIFY_PATH = "/wechat-pay/notify";

const ACTIONS = new Set(["createWechatPayment", "queryWechatPayment"]);

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

function createPaymentService({ businessService }) {
  const nonce = () => crypto.randomBytes(16).toString("hex");
  const sign = (text, privateKey) => crypto.sign("RSA-SHA256", Buffer.from(text), privateKey).toString("base64");

  async function api(method, path, payload) {
    const ready = paymentReadiness(); const cfg = ready.config; const body = payload ? JSON.stringify(payload) : ""; const timestamp = String(Math.floor(Date.now() / 1000)); const nonceStr = nonce(); const signature = sign(`${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`, cfg.privateKey);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`;
    const response = await request({ hostname: "api.mch.weixin.qq.com", port: 443, path, method, headers: { Accept: "application/json", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: authorization, "User-Agent": "NanlianSportSystem/1.0" } }, body);
    const responseTimestamp = response.headers["wechatpay-timestamp"], responseNonce = response.headers["wechatpay-nonce"], responseSignature = response.headers["wechatpay-signature"], responseSerial = response.headers["wechatpay-serial"];
    let responseKey;
    try { responseKey = verificationKeyForSerial(String(responseSerial || ""), { publicKey: cfg.publicKey, publicKeyId: cfg.publicKeyId, verificationKeys: cfg.verificationKeys }); } catch (error) { throw new PaymentError("SIGNATURE_INVALID", "微信支付API应答验签公钥未配置"); }
    if (!responseTimestamp || !responseNonce || !responseSignature || !responseSerial || !crypto.verify("RSA-SHA256", Buffer.from(`${responseTimestamp}\n${responseNonce}\n${response.body}\n`), responseKey, Buffer.from(responseSignature, "base64"))) throw new PaymentError("SIGNATURE_INVALID", "微信支付API应答验签失败");
    let data = {}; try { data = response.body ? JSON.parse(response.body) : {}; } catch (error) { throw new Error("微信支付返回内容无法解析"); }
    if (response.statusCode < 200 || response.statusCode >= 300) { const error = new Error(data.message || `微信支付接口错误 ${response.statusCode}`); error.code = data.code || "WECHAT_PAY_API_ERROR"; throw error; }
    return data;
  }

  function publicUnavailable() { return { configured: false, enabled: false, status: "NOT_READY" }; }

  function clientPaymentParameters(order, prepayId, cfg) {
    const timeStamp = String(Math.floor(Date.now() / 1000)); const nonceStr = nonce(); const packageValue = `prepay_id=${prepayId}`; const paySign = sign(`${cfg.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, cfg.privateKey);
    return { configured: true, orderId: order._id, timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign };
  }

  async function create(user, input, openid) {
    const ready = paymentReadiness(); if (!ready.ready) return publicUnavailable();
    if (!user || user.role !== "parent") throw new Error("只有家长账号可以发起微信支付");
    let order = await businessService.payableOrder(user, input.id, { requireCurrentOwnership: true });
    if (order.paymentStatus === "CLOSED") { const replacement = await businessService.replaceClosedWechatOrder(user, order._id); order = await businessService.payableOrder(user, replacement.id, { requireCurrentOwnership: true }); }
    if (order.status === "PAID") return { configured: true, alreadyPaid: true };
    if (Number(order.payableAmount || 0) === 0) { await businessService.settleOrder(order._id, { paymentMethod: "COUPON", operatorId: "SYSTEM" }); return { configured: true, freeOrder: true }; }
    const latest = await businessService.latestPaymentAttempt(order._id); const latestCreated = latest && Date.parse(String(latest.createdAt || "").replace(" ", "T") + ":00+08:00");
    if (latest && latest.prepayId && latestCreated && Date.now() - latestCreated < 90 * 60 * 1000) return clientPaymentParameters(order, latest.prepayId, ready.config);
    const paymentId = await businessService.recordPaymentEvent(order, { status: "PENDING", source: "JSAPI_CREATE" });
    try {
      const cfg = ready.config; const result = await api("POST", "/v3/pay/transactions/jsapi", { appid: cfg.appid, mchid: cfg.mchid, description: order.courseTypeName || "俱乐部课程", out_trade_no: order.orderNo, notify_url: cfg.notifyUrl, amount: { total: Number(order.payableAmount), currency: "CNY" }, payer: { openid }, attach: order._id });
      if (!result.prepay_id) throw new Error("微信支付未返回预支付编号");
      await businessService.updatePaymentEvent(paymentId, { prepayId: result.prepay_id, status: "PROCESSING" });
      return clientPaymentParameters(order, result.prepay_id, cfg);
    } catch (error) {
      await businessService.updatePaymentEvent(paymentId, { status: "FAILED", errorCode: error.code || "JSAPI_CREATE_FAILED" });
      throw error;
    }
  }

  async function query(user, input) {
    const ready = paymentReadiness(); if (!ready.configured || !ready.appIdMatches) return publicUnavailable();
    if (!user || user.role !== "parent") throw new Error("只有家长账号可以查询微信支付订单");
    const order = await businessService.payableOrder(user, input.id, { requireCurrentOwnership: false });
    if (order.status === "PAID") return { configured: true, paid: true, tradeState: "SUCCESS" };
    const cfg = ready.config; const result = await api("GET", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.orderNo)}?mchid=${encodeURIComponent(cfg.mchid)}`);
    await businessService.recordPaymentEvent(order, { transactionId: result.transaction_id || "", amountFen: Number((result.amount || {}).total || order.payableAmount), currency: String((result.amount || {}).currency || "CNY"), status: result.trade_state === "SUCCESS" ? "PROCESSING" : (result.trade_state === "CLOSED" ? "CLOSED" : "PENDING"), source: "ACTIVE_QUERY" });
    if (result.trade_state === "CLOSED") { await businessService.markWechatOrderClosed(order._id); return { configured: true, paid: false, tradeState: "CLOSED", tradeStateDesc: result.trade_state_desc || "订单已关闭，再次支付时将生成新订单。" }; }
    if (result.trade_state !== "SUCCESS") return { configured: true, paid: false, tradeState: result.trade_state || "UNKNOWN", tradeStateDesc: result.trade_state_desc || "" };
    const settled = await businessService.verifyAndSettleWechatPayment(result, { orderId: order._id, orderNo: order.orderNo, source: "ACTIVE_QUERY" });
    return { configured: true, paid: settled.paid, reviewRequired: settled.reviewRequired, tradeState: settled.reviewRequired ? "PAYMENT_REVIEW_REQUIRED" : "SUCCESS" };
  }

  function isHttpNotifyEvent(event = {}) {
    const method = String(event.httpMethod || (((event.requestContext || {}).http || {}).method) || "").toUpperCase();
    const path = String(event.path || event.rawPath || (((event.requestContext || {}).http || {}).path) || "").replace(/\/+$/, "") || "/";
    return method === "POST" && path === NOTIFY_PATH;
  }

  function httpResponse(statusCode, body = "") { return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8" }, isBase64Encoded: false, body: body ? JSON.stringify(body) : "" }; }

  async function handleNotify(event) {
    const ready = paymentReadiness();
    if (!ready.configured || !ready.appIdMatches) return httpResponse(503, { code: "FAIL", message: "支付服务暂不可用" });
    const body = rawEventBody(event); const headers = normalizeHeaders(event.headers || {});
    try {
      verifyWechatpaySignature({ headers, body, publicKey: ready.config.publicKey, publicKeyId: ready.config.publicKeyId, verificationKeys: ready.config.verificationKeys });
      let notification; try { notification = JSON.parse(body); } catch (error) { throw new PaymentError("DECRYPT_FAILED", "微信支付通知JSON无效"); }
      if (notification.event_type !== "TRANSACTION.SUCCESS" || notification.resource_type !== "encrypt-resource") throw new PaymentError("TRADE_STATE_NOT_SUCCESS", "微信支付通知类型不受支持");
      const transaction = decryptWechatpayResource(notification.resource, ready.config.apiV3Key);
      await businessService.verifyAndSettleWechatPayment(transaction, { orderNo: transaction.out_trade_no, source: "WECHAT_NOTIFY", notificationId: notification.id });
      return httpResponse(200);
    } catch (error) {
      if (!["APPID_MISMATCH", "MCHID_MISMATCH", "ORDER_NOT_FOUND", "ORDER_NO_MISMATCH", "AMOUNT_MISMATCH", "CURRENCY_MISMATCH", "TRADE_STATE_NOT_SUCCESS", "TRADE_TYPE_MISMATCH", "TRANSACTION_ID_CONFLICT", "ORDER_NO_CONFLICT"].includes(error.code)) await businessService.paymentSecurityLog(error, { source: "WECHAT_NOTIFY" });
      const status = Number(error.httpStatus || (error.code === "SIGNATURE_INVALID" ? 401 : 400));
      return httpResponse(status, { code: "FAIL", message: "支付通知处理失败" });
    }
  }

  async function call(action, input, user, openid) {
    try {
      if (action === "createWechatPayment") return await create(user, input, openid);
      if (action === "queryWechatPayment") return await query(user, input);
      throw new Error("未知支付操作");
    } catch (error) {
      if (error.code === "STUDENT_OWNERSHIP_CHANGED") throw error;
      const safe = new Error(error.safeMessage || (action === "createWechatPayment" ? "微信支付发起失败，请稍后重试。" : "支付状态确认异常，请联系俱乐部工作人员。"));
      safe.code = "PAYMENT_CONFIRMATION_FAILED";
      throw safe;
    }
  }
  return { handles: (action) => ACTIONS.has(action), call, isHttpNotifyEvent, handleNotify };
}

module.exports = { NOTIFY_PATH, createPaymentService };
