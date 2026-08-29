const crypto = require("crypto");
const { PaymentError, verifyTransaction, paymentEnvironmentCheck, paymentReadiness } = require("./payment-security");

const ACTIONS = new Set([
  "registerMember",
  "listUsers",
  "listNews",
  "saveNews",
  "listCommerceConfig",
  "saveCourseType",
  "savePricingRule",
  "saveCoupon",
  "listCatalog",
  "createOrder",
  "listOrders",
  "confirmOrderPayment",
  "getPaymentReadiness",
  "getPaymentDiagnostics",
  "getPaymentOrderDiagnostics",
  "checkPaymentAcceptance",
  "listCoursePackages",
  "saveCoursePackage",
  "setCoursePackageStatus",
  "listLessonEntitlements",
  "extendLessonEntitlement",
  "adjustStudentLessons",
  "listNotifications",
  "markNotificationRead",
]);

function createBusinessService({ db, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit, assertStudentAccess, firstOwnedStudentId }) {
  const command = db.command;
  const PACKAGE_DEFAULTS = [
    { packageCode: "NL14", name: "14节训练套餐", lessonCount: 14, priceFen: 138000, validityMonths: 5, sortOrder: 10 },
    { packageCode: "NL28", name: "28节训练套餐", lessonCount: 28, priceFen: 198000, validityMonths: 9, sortOrder: 20 },
    { packageCode: "NL40", name: "40节训练套餐", lessonCount: 40, priceFen: 248000, validityMonths: 12, sortOrder: 30 },
    { packageCode: "PAYMENT_TEST_1", name: "支付测试套餐", lessonCount: 1, priceFen: 100, validityMonths: 1, sortOrder: 999, status: "INACTIVE", isPaymentTest: true, adminOnlyActivation: true },
  ];

  function dateText(value) { return String(value || nowText()).slice(0, 10); }
  function addDays(value, days) { const d = new Date(`${dateText(value)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(days || 0)); return d.toISOString().slice(0, 10); }
  function addMonths(value, months) {
    const source = dateText(value), [year, month, day] = source.split("-").map(Number);
    const target = new Date(Date.UTC(year, month - 1 + Number(months || 0), 1, 12));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target.toISOString().slice(0, 10);
  }

  function code(prefix) {
    return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  async function ensureDefaults() {
    const count = await db.collection("courseTypes").count();
    if (!count.total) {
      const now = nowText();
      await db.collection("courseTypes").add({ data: { name: "常规训练课", lessons: 14, description: "俱乐部常规班训练课包", status: "ACTIVE", createdAt: now, updatedAt: now } });
      await db.collection("courseTypes").add({ data: { name: "强化训练课", lessons: 28, description: "提高训练频次的强化课包", status: "ACTIVE", createdAt: now, updatedAt: now } });
    }
    const packages = await fetchAll("coursePackages");
    const now = nowText();
    for (const item of PACKAGE_DEFAULTS) if (!packages.some((row) => row.packageCode === item.packageCode)) {
      await db.collection("coursePackages").add({ data: { ...item, description: item.isPaymentTest ? "仅用于内部1元真实支付链路验收" : "", applicableClassTypes: ["REGULAR"], status: item.status || "ACTIVE", createdBy: "SYSTEM", createdAt: now, updatedAt: now } });
    }
  }

  function packageView(item) { return { ...publicDoc(item), priceYuan: (Number(item.priceFen || 0) / 100).toFixed(2), validityLabel: `激活后${Number(item.validityMonths || 0)}个月` }; }
  async function listCoursePackages(user) {
    requireRole(user, ["admin", "parent"]); await ensureDefaults();
    let rows = await fetchAll("coursePackages"); if (user.role === "parent") rows = rows.filter((item) => item.status === "ACTIVE");
    return rows.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name))).map(packageView);
  }
  async function saveCoursePackage(user, input) {
    requireRole(user, ["admin"]); const item = input.item || {}; const previous = item.id ? (await db.collection("coursePackages").doc(item.id).get().catch(() => ({ data: null }))).data : null;
    const data = { name: String(item.name || "").trim(), lessonCount: Number(item.lessonCount || 0), priceFen: Math.round(Number(item.priceYuan === undefined ? Number(item.priceFen || 0) / 100 : item.priceYuan) * 100), validityMonths: Number(item.validityMonths || 0), description: String(item.description || "").trim(), applicableClassTypes: Array.isArray(item.applicableClassTypes) && item.applicableClassTypes.length ? [...new Set(item.applicableClassTypes)] : ["REGULAR"], sortOrder: Number(item.sortOrder || 0), status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: nowText() };
    if (!data.name || !Number.isInteger(data.lessonCount) || data.lessonCount <= 0 || !Number.isInteger(data.priceFen) || data.priceFen <= 0 || !Number.isInteger(data.validityMonths) || data.validityMonths <= 0) throw new Error("请完整填写套餐名称、整数课时、价格和有效期月数");
    let id = item.id; if (id) await db.collection("coursePackages").doc(id).update({ data }); else { const added = await db.collection("coursePackages").add({ data: { ...data, packageCode: `CUSTOM_${Date.now()}`, createdBy: user._id, createdAt: nowText() } }); id = added._id; }
    await audit(user, previous ? "UPDATE_COURSE_PACKAGE" : "CREATE_COURSE_PACKAGE", "coursePackage", id, { oldPackage: previous ? { lessonCount: previous.lessonCount, priceFen: previous.priceFen, validityMonths: previous.validityMonths, status: previous.status } : null, newPackage: data }); return { id };
  }
  async function setCoursePackageStatus(user, input) { requireRole(user, ["admin"]); const item = (await db.collection("coursePackages").doc(input.id).get()).data; if (!item) throw new Error("套餐不存在"); const status = input.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"; await db.collection("coursePackages").doc(input.id).update({ data: { status, updatedAt: nowText() } }); await audit(user, "SET_COURSE_PACKAGE_STATUS", "coursePackage", input.id, { oldStatus: item.status, newStatus: status }); return { ok: true, status }; }

  async function notify(targetUserId, type, title, content, related = {}) {
    if (!targetUserId) return null;
    const now = nowText();
    const added = await db.collection("notifications").add({ data: { targetUserId, type, title, content, related, status: "UNREAD", deliveryStatus: "IN_APP", createdAt: now, updatedAt: now } });
    return added._id;
  }

  async function registerMember(user, input) {
    requireRole(user, ["parent"]);
    const profile = input.profile || {};
    const name = String(profile.name || "").trim();
    const mobile = String(profile.mobile || profile.guardianPhone || "").trim();
    const birthDate = String(profile.birthDate || "");
    if (!name || !birthDate || !profile.gender || !mobile) throw new Error("请填写姓名、出生日期、性别和联系电话");
    const existing = await db.collection("students").where({ ownerParentUserId: user._id, name, birthDate, status: "active" }).limit(1).get();
    if (existing.data.length) throw new Error("该学员已经注册，无需重复提交");
    const now = nowText();
    const added = await db.collection("students").add({ data: { name, avatarUrl: profile.avatarUrl || "", gender: profile.gender, birthDate, school: String(profile.school || ""), grade: String(profile.grade || ""), guardianName: String(profile.guardianName || user.name || name), guardianPhone: mobile, emergencyContact: String(profile.emergencyContact || `${user.name || name} ${mobile}`), healthNotes: String(profile.remark || "无"), remainingLessons: 0, totalLessons: 0, classIds: [], ownerParentUserId: user._id, profileStatus: "ACTIVE", status: "active", registrationDate: now.slice(0, 10), registrationSource: "SELF_REGISTER", createdAt: now, updatedAt: now } });
    await db.collection("parentStudentLinks").add({ data: { parentUserId: user._id, studentId: added._id, relationship: profile.relationship || "GUARDIAN", isPrimaryGuardian: true, status: "ACTIVE", source: "SELF_REGISTER", createdAt: now, updatedAt: now } });
    const studentIds = [...new Set([...(user.studentIds || []), added._id])];
    await db.collection("users").doc(user._id).update({ data: { name: String(profile.accountName || user.name || name), mobile, studentIds, profileCompleted: true, updatedAt: now } });
    await audit(user, "REGISTER_MEMBER", "student", added._id, { studentId: added._id, source: "SELF_REGISTER" });
    return { id: added._id, status: "ACTIVE" };
  }

  async function listUsers(user) {
    requireRole(user, ["admin"]);
    return (await fetchAll("users")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ id: item._id, name: item.name || "未填写姓名", mobile: item.mobile || "", role: item.role, status: item.active === false ? "DISABLED" : String(item.status || "ACTIVE").toUpperCase(), classIds: item.classIds || [], studentIds: item.studentIds || [], createdAt: item.createdAt || "" }));
  }

  async function listNews(user, input) {
    let rows = await fetchAll("news");
    if (user.role !== "admin" || !input.includeAll) rows = rows.filter((item) => item.status === "PUBLISHED");
    return rows.sort((a, b) => String(b.publishedAt || b.updatedAt || b.createdAt).localeCompare(String(a.publishedAt || a.updatedAt || a.createdAt))).map(publicDoc);
  }

  async function saveNews(user, input) {
    requireRole(user, ["admin"]);
    const item = input.item || {};
    const title = String(item.title || "").trim();
    const content = String(item.content || "").trim();
    if (!title || !content) throw new Error("请填写标题和正文");
    const now = nowText();
    const data = { title, summary: String(item.summary || content.slice(0, 60)), content, coverUrl: String(item.coverUrl || ""), category: String(item.category || "公告"), status: item.status === "DRAFT" ? "DRAFT" : "PUBLISHED", publishedAt: item.status === "DRAFT" ? "" : (item.publishedAt || now), updatedAt: now, authorId: user._id, authorName: user.name };
    let id = item.id;
    if (id) await db.collection("news").doc(id).update({ data });
    else { const added = await db.collection("news").add({ data: { ...data, createdAt: now } }); id = added._id; }
    await audit(user, "SAVE_NEWS", "news", id, { title, status: data.status });
    return { id };
  }

  async function listCommerceConfig(user) {
    requireRole(user, ["admin"]);
    await ensureDefaults();
    const [courseTypes, pricingRules, coupons, users] = await Promise.all([fetchAll("courseTypes"), fetchAll("pricingRules"), fetchAll("coupons"), fetchAll("users")]);
    const coaches = users.filter((item) => item.role === "coach").map((item) => ({ id: item._id, name: item.name || "未命名教练" }));
    return { courseTypes: courseTypes.map(publicDoc), pricingRules: pricingRules.map((item) => ({ ...publicDoc(item), courseTypeName: (courseTypes.find((row) => row._id === item.courseTypeId) || {}).name || "", coachName: (users.find((row) => row._id === item.coachId) || {}).name || "" })), coupons: coupons.map(publicDoc), coaches };
  }

  async function saveCourseType(user, input) {
    requireRole(user, ["admin"]);
    const item = input.item || {};
    const name = String(item.name || "").trim();
    const lessons = Math.max(1, Number(item.lessons || 1));
    if (!name) throw new Error("请填写课程类型名称");
    const now = nowText(); const data = { name, lessons, description: String(item.description || ""), status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: now }; let id = item.id;
    if (id) await db.collection("courseTypes").doc(id).update({ data }); else { const added = await db.collection("courseTypes").add({ data: { ...data, createdAt: now } }); id = added._id; }
    await audit(user, "SAVE_COURSE_TYPE", "courseType", id, data); return { id };
  }

  async function savePricingRule(user, input) {
    requireRole(user, ["admin"]);
    const item = input.item || {}; const coachId = String(item.coachId || ""); const courseTypeId = String(item.courseTypeId || ""); const amount = Math.round(Number(item.amount || 0) * 100);
    if (!coachId || !courseTypeId || amount <= 0) throw new Error("请选择教练、课程类型并填写价格");
    const duplicate = await db.collection("pricingRules").where({ coachId, courseTypeId, status: "ACTIVE" }).limit(10).get();
    if (duplicate.data.some((row) => row._id !== item.id)) throw new Error("该教练和课程类型已经配置价格");
    const now = nowText(); const data = { coachId, courseTypeId, amount, status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: now }; let id = item.id;
    if (id) await db.collection("pricingRules").doc(id).update({ data }); else { const added = await db.collection("pricingRules").add({ data: { ...data, createdAt: now } }); id = added._id; }
    await audit(user, "SAVE_PRICING_RULE", "pricingRule", id, data); return { id };
  }

  async function saveCoupon(user, input) {
    requireRole(user, ["admin"]);
    const item = input.item || {}; const couponCode = String(item.code || "").trim().toUpperCase(); const discountType = item.discountType === "FIXED" ? "FIXED" : "PERCENT"; const discountValue = Number(item.discountValue || 0);
    if (!/^[A-Z0-9]{4,20}$/.test(couponCode)) throw new Error("优惠码需为4到20位字母或数字");
    if (discountValue <= 0 || discountType === "PERCENT" && discountValue >= 100) throw new Error("优惠数值无效");
    const found = await db.collection("coupons").where({ code: couponCode }).limit(10).get(); if (found.data.some((row) => row._id !== item.id)) throw new Error("优惠码已经存在");
    const now = nowText(); const data = { code: couponCode, name: String(item.name || couponCode), discountType, discountValue, minAmount: Math.max(0, Math.round(Number(item.minAmount || 0) * 100)), totalLimit: Math.max(0, Number(item.totalLimit || 0)), usedCount: Number(item.usedCount || 0), startAt: String(item.startAt || now.slice(0, 10)), endAt: String(item.endAt || "2099-12-31"), status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: now }; let id = item.id;
    if (id) await db.collection("coupons").doc(id).update({ data }); else { const added = await db.collection("coupons").add({ data: { ...data, createdAt: now } }); id = added._id; }
    await audit(user, "SAVE_COUPON", "coupon", id, { code: couponCode }); return { id };
  }

  async function listCatalog() {
    await ensureDefaults();
    const [types, rules, users] = await Promise.all([fetchAll("courseTypes", { status: "ACTIVE" }), fetchAll("pricingRules", { status: "ACTIVE" }), fetchAll("users")]);
    return rules.map((item) => { const type = types.find((row) => row._id === item.courseTypeId); const coach = users.find((row) => row._id === item.coachId); return { ...publicDoc(item), amountYuan: (Number(item.amount || 0) / 100).toFixed(2), courseType: type ? publicDoc(type) : null, coach: coach ? { id: coach._id, name: coach.name || "未命名教练" } : null }; }).filter((item) => item.courseType && item.coach);
  }

  async function couponDiscount(user, codeValue, originalAmount) {
    const value = String(codeValue || "").trim().toUpperCase(); if (!value) return { coupon: null, discountAmount: 0 };
    const found = await db.collection("coupons").where({ code: value, status: "ACTIVE" }).limit(1).get(); const coupon = found.data[0]; if (!coupon) throw new Error("优惠码不存在或已停用");
    const today = nowText().slice(0, 10); if (today < coupon.startAt || today > coupon.endAt) throw new Error("优惠码不在有效期内"); if (Number(coupon.totalLimit || 0) && Number(coupon.usedCount || 0) >= Number(coupon.totalLimit)) throw new Error("优惠码已经领完"); if (originalAmount < Number(coupon.minAmount || 0)) throw new Error("订单金额未达到优惠门槛");
    const used = await db.collection("couponRedemptions").where({ couponId: coupon._id, userId: user._id }).limit(1).get(); if (used.data.length) throw new Error("该优惠码每个账号限用一次");
    const discountAmount = coupon.discountType === "FIXED" ? Math.min(originalAmount, Math.round(Number(coupon.discountValue) * 100)) : Math.min(originalAmount, Math.round(originalAmount * Number(coupon.discountValue) / 100));
    return { coupon, discountAmount };
  }

  async function createOrder(user, input) {
    requireRole(user, ["admin", "parent"]);
    const studentId = input.studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : ""); await assertStudentAccess(user, studentId);
    if (input.packageId) {
      const item = (await db.collection("coursePackages").doc(input.packageId).get().catch(() => ({ data: null }))).data;
      if (!item || item.status !== "ACTIVE") throw new Error("课时套餐已停售");
      if (item.isPaymentTest && String(input.couponCode || "").trim()) throw new Error("支付测试套餐不使用优惠券，必须按1元完成真实支付");
      const originalAmount = Number(item.priceFen || 0); const { coupon, discountAmount } = await couponDiscount(user, input.couponCode, originalAmount); const payableAmount = Math.max(0, originalAmount - discountAmount); const now = nowText(); const orderNo = code("NL");
      const packageSnapshot = { packageId: item._id, packageCode: item.packageCode || "", packageName: item.name, lessonCount: Number(item.lessonCount || 0), priceFen: originalAmount, validityMonthsSnapshot: Number(item.validityMonths || 0), applicableClassTypes: item.applicableClassTypes || ["REGULAR"], isPaymentTest: item.isPaymentTest === true };
      const added = await db.collection("orders").add({ data: { orderNo, userId: user._id, studentId, orderType: "LESSON_PACKAGE", packageId: item._id, packageSnapshot, courseTypeName: item.name, lessons: packageSnapshot.lessonCount, originalAmount, discountAmount, payableAmount, couponId: coupon ? coupon._id : "", couponCode: coupon ? coupon.code : "", status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paymentMethod: "WECHAT_PAY", createdAt: now, updatedAt: now } });
      await audit(user, "CREATE_PACKAGE_ORDER", "order", added._id, { orderNo, studentId, packageSnapshot, payableAmount }); return { id: added._id, orderNo, payableAmount, amountYuan: (payableAmount / 100).toFixed(2), paymentConfigured: paymentReadiness().ready };
    }
    const rule = (await db.collection("pricingRules").doc(input.pricingRuleId).get()).data; if (!rule || rule.status !== "ACTIVE") throw new Error("价格规则已失效");
    const type = (await db.collection("courseTypes").doc(rule.courseTypeId).get()).data; if (!type || type.status !== "ACTIVE") throw new Error("课程类型已停用");
    const originalAmount = Number(rule.amount || 0); const { coupon, discountAmount } = await couponDiscount(user, input.couponCode, originalAmount); const payableAmount = Math.max(0, originalAmount - discountAmount); const now = nowText(); const orderNo = code("NL");
    const added = await db.collection("orders").add({ data: { orderNo, userId: user._id, studentId, pricingRuleId: rule._id, coachId: rule.coachId, courseTypeId: type._id, courseTypeName: type.name, lessons: Number(type.lessons || 0), originalAmount, discountAmount, payableAmount, couponId: coupon ? coupon._id : "", couponCode: coupon ? coupon.code : "", status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paymentMethod: "WECHAT_PAY", createdAt: now, updatedAt: now } });
    await audit(user, "CREATE_ORDER", "order", added._id, { orderNo, payableAmount, paymentConfigured: paymentReadiness().ready }); return { id: added._id, orderNo, payableAmount, amountYuan: (payableAmount / 100).toFixed(2), paymentConfigured: paymentReadiness().ready };
  }

  async function listOrders(user) {
    if (user.role === "coach") return [];
    let rows = await fetchAll("orders"); if (user.role === "parent") rows = rows.filter((item) => item.userId === user._id);
    const students = await fetchByIds("students", rows.map((item) => item.studentId)); return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ ...publicDoc(item), displayName: (item.packageSnapshot || {}).packageName || item.courseTypeName || "课时订单", lessonCount: Number((item.packageSnapshot || {}).lessonCount || item.lessons || 0), validityMonthsSnapshot: Number((item.packageSnapshot || {}).validityMonthsSnapshot || 0), studentName: (students.find((student) => student._id === item.studentId) || {}).name || "", amountYuan: (Number(item.payableAmount || 0) / 100).toFixed(2) }));
  }

  async function payableOrder(user, id, options = {}) {
    const order = (await db.collection("orders").doc(id).get()).data; if (!order) throw new Error("订单不存在");
    if (user.role === "parent" && order.userId !== user._id) throw new Error("无权支付该订单");
    if (user.role === "coach") throw new Error("教练不能支付学员订单");
    if (user.role === "parent" && options.requireCurrentOwnership !== false) {
      const student = (await db.collection("students").doc(order.studentId).get().catch(() => ({ data: null }))).data;
      if (!student || student.ownerParentUserId !== user._id) {
        const error = new Error("学员归属已经变化，请联系俱乐部工作人员处理"); error.code = "STUDENT_OWNERSHIP_CHANGED"; throw error;
      }
    }
    if (order.status === "PAID") return order;
    if (order.status !== "PENDING_PAYMENT") throw new Error("订单当前不可支付");
    return order;
  }

  async function recordPaymentEvent(order, detail = {}) {
    if (!order) return "";
    const now = nowText();
    const added = await db.collection("payments").add({ data: {
      orderId: order._id, orderNo: order.orderNo, studentId: order.studentId, userId: order.userId,
      paymentMethod: "WECHAT_PAY", prepayId: String(detail.prepayId || ""), transactionId: String(detail.transactionId || ""),
      amountFen: Number(detail.amountFen === undefined ? order.payableAmount : detail.amountFen), currency: String(detail.currency || "CNY"),
      status: String(detail.status || "PENDING"), source: String(detail.source || "JSAPI_CREATE"),
      errorCode: String(detail.errorCode || ""), createdAt: now, updatedAt: now,
    } });
    return added._id;
  }

  async function updatePaymentEvent(id, detail = {}) {
    if (!id) return;
    const allowed = ["prepayId", "transactionId", "amountFen", "currency", "status", "source", "errorCode"];
    const data = { updatedAt: nowText() };
    for (const key of allowed) if (detail[key] !== undefined) data[key] = detail[key];
    await db.collection("payments").doc(id).update({ data });
  }

  async function latestPaymentAttempt(orderId) {
    const result = await db.collection("payments").where({ orderId, paymentMethod: "WECHAT_PAY", status: "PROCESSING" }).orderBy("createdAt", "desc").limit(1).get();
    return result.data[0] || null;
  }

  async function replaceClosedWechatOrder(user, orderId) {
    const order = await payableOrder(user, orderId, { requireCurrentOwnership: true });
    if (order.paymentStatus !== "CLOSED") throw new Error("订单尚未关闭，无需重新生成支付尝试");
    const now = nowText(), orderNo = code("NL");
    const replacement = { ...order, orderNo, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paymentMethod: "WECHAT_PAY", replacementForOrderId: order._id, createdAt: now, updatedAt: now };
    ["_id", "transactionId", "paidAt", "settledAt", "operatorId", "reviewReason", "pendingTransactionId", "replacedByOrderId"].forEach((key) => delete replacement[key]);
    const added = await db.collection("orders").add({ data: replacement });
    await db.collection("orders").doc(order._id).update({ data: { status: "CANCELLED", paymentStatus: "CLOSED", replacedByOrderId: added._id, updatedAt: now } });
    await audit(user, "REPLACE_CLOSED_WECHAT_ORDER", "order", added._id, { oldOrderId: order._id, oldOrderNo: order.orderNo, newOrderNo: orderNo });
    return { id: added._id, orderNo };
  }

  async function markWechatOrderClosed(orderId) {
    const order = (await db.collection("orders").doc(orderId).get()).data;
    if (order && order.status === "PENDING_PAYMENT") await db.collection("orders").doc(orderId).update({ data: { paymentStatus: "CLOSED", updatedAt: nowText() } });
  }

  async function paymentSecurityLog(error, detail = {}) {
    const now = nowText();
    await db.collection("paymentSecurityLogs").add({ data: {
      code: String((error || {}).code || detail.code || "PAYMENT_SECURITY_ERROR"), orderId: String(detail.orderId || ""),
      orderNo: String(detail.orderNo || ""), transactionId: String(detail.transactionId || ""), source: String(detail.source || "UNKNOWN"),
      message: String((error || {}).message || "支付安全校验失败").slice(0, 200), createdAt: now,
    } });
  }

  async function verifyAndSettleWechatPayment(transaction, context = {}) {
    const orderNo = String((transaction || {}).out_trade_no || context.orderNo || "");
    const found = orderNo ? await db.collection("orders").where({ orderNo }).limit(2).get() : { data: [] };
    const order = context.orderId ? (await db.collection("orders").doc(context.orderId).get().catch(() => ({ data: null }))).data : found.data[0];
    try {
      if (!order) throw new PaymentError("ORDER_NOT_FOUND", "支付订单不存在");
      if (found.data.length > 1) throw new PaymentError("ORDER_NO_CONFLICT", "商户订单号存在重复记录");
      const verified = verifyTransaction(order, transaction, paymentReadiness().config);
      const transactionOrders = await db.collection("orders").where({ transactionId: verified.transactionId }).limit(2).get();
      if (transactionOrders.data.some((item) => item._id !== order._id)) throw new PaymentError("TRANSACTION_ID_CONFLICT", "微信交易号已经绑定其他订单");
      await recordPaymentEvent(order, { ...verified, status: order.status === "PAID" ? "SUCCESS" : "PROCESSING", source: context.source || "WECHAT_NOTIFY" });
      if (order.status === "PAID") {
        if (!order.transactionId || order.transactionId !== verified.transactionId) throw new PaymentError("TRANSACTION_ID_CONFLICT", "已支付订单对应不同微信交易号");
        return { paid: true, idempotent: true, transactionId: verified.transactionId };
      }
      if (order.status !== "PENDING_PAYMENT") {
        const now = nowText();
        await db.collection("orders").doc(order._id).update({ data: { paymentStatus: "PAYMENT_REVIEW_REQUIRED", reviewReason: "ORDER_STATUS_CHANGED_AFTER_PAYMENT", pendingTransactionId: verified.transactionId, updatedAt: now } });
        await db.collection("auditLogs").add({ data: { userId: "SYSTEM", role: "system", action: "PAYMENT_REVIEW_REQUIRED", targetType: "order", targetId: order._id, orderId: order._id, orderNo: order.orderNo, studentId: order.studentId, transactionId: verified.transactionId, amountFen: verified.amountFen, source: context.source || "WECHAT_NOTIFY", reason: "ORDER_STATUS_CHANGED_AFTER_PAYMENT", createdAt: now } });
        return { paid: false, reviewRequired: true, code: "PAYMENT_REVIEW_REQUIRED" };
      }
      const student = (await db.collection("students").doc(order.studentId).get().catch(() => ({ data: null }))).data;
      if (!student || student.ownerParentUserId !== order.userId) {
        const now = nowText();
        await db.collection("orders").doc(order._id).update({ data: { paymentStatus: "PAYMENT_REVIEW_REQUIRED", reviewReason: "STUDENT_OWNERSHIP_CHANGED", pendingTransactionId: verified.transactionId, updatedAt: now } });
        await db.collection("auditLogs").add({ data: { userId: "SYSTEM", role: "system", action: "PAYMENT_REVIEW_REQUIRED", targetType: "order", targetId: order._id, orderId: order._id, orderNo: order.orderNo, studentId: order.studentId, transactionId: verified.transactionId, amountFen: verified.amountFen, source: context.source || "WECHAT_NOTIFY", reason: "STUDENT_OWNERSHIP_CHANGED", createdAt: now } });
        return { paid: false, reviewRequired: true, code: "PAYMENT_REVIEW_REQUIRED" };
      }
      const result = await settleOrder(order._id, { paymentMethod: "WECHAT_PAY", transactionId: verified.transactionId, operatorId: "SYSTEM", source: context.source || "ACTIVE_QUERY", verifiedPayment: verified });
      return { paid: true, idempotent: !result.settled, transactionId: verified.transactionId };
    } catch (error) {
      await paymentSecurityLog(error, { orderId: order ? order._id : context.orderId, orderNo, transactionId: String((transaction || {}).transaction_id || ""), source: context.source });
      throw error;
    }
  }

  async function settleOrder(orderId, options = {}) {
    const now = nowText(); let settled = false;
    await db.runTransaction(async (transaction) => { const order = (await transaction.collection("orders").doc(orderId).get()).data; if (!order) throw new Error("订单不存在");
      if ((options.paymentMethod || "WECHAT_PAY") === "WECHAT_PAY" && !options.verifiedPayment) throw new PaymentError("UNVERIFIED_WECHAT_PAYMENT", "微信支付订单未经交易校验");
      if (order.status === "PAID") { if (options.transactionId && order.transactionId && order.transactionId !== options.transactionId) throw new PaymentError("TRANSACTION_ID_CONFLICT", "已支付订单对应不同微信交易号"); return; }
      if (order.status !== "PENDING_PAYMENT") throw new Error("订单状态无法确认");
      if (options.transactionId) { const claimId = crypto.createHash("sha256").update(String(options.transactionId)).digest("hex"); const claim = (await transaction.collection("paymentTransactionClaims").doc(claimId).get().catch(() => ({ data: null }))).data; if (claim && claim.orderId !== orderId) throw new PaymentError("TRANSACTION_ID_CONFLICT", "微信交易号已经绑定其他订单"); if (!claim) await transaction.collection("paymentTransactionClaims").doc(claimId).set({ data: { transactionId: options.transactionId, orderId, orderNo: order.orderNo, createdAt: now } }); }
      const student = (await transaction.collection("students").doc(order.studentId).get()).data; const lessons = Number((order.packageSnapshot || {}).lessonCount || order.lessons || 0); const balance = Number(student.remainingLessons || 0) + lessons; await transaction.collection("orders").doc(orderId).update({ data: { status: "PAID", paymentStatus: "PAID", paymentMethod: options.paymentMethod || "WECHAT_PAY", transactionId: options.transactionId || "", paidAt: now, operatorId: options.operatorId || "SYSTEM", settledAt: now, updatedAt: now } });
      let entitlementId = "";
      if (order.orderType === "LESSON_PACKAGE" && order.packageSnapshot) { const existing = (await transaction.collection("lessonEntitlements").where({ orderId }).limit(1).get()).data[0]; if (!existing) { const added = await transaction.collection("lessonEntitlements").add({ data: { studentId: order.studentId, orderId, packageId: order.packageSnapshot.packageId, packageNameSnapshot: order.packageSnapshot.packageName, purchasedLessons: lessons, remainingLessons: lessons, priceFenSnapshot: Number(order.packageSnapshot.priceFen || order.originalAmount || 0), validityMonthsSnapshot: Number(order.packageSnapshot.validityMonthsSnapshot || 0), extensionDays: 0, activatedAt: "", expiresAt: "", status: "UNACTIVATED", createdAt: now, updatedAt: now } }); entitlementId = added._id; await transaction.collection("lessonEntitlementEvents").add({ data: { entitlementId, studentId: order.studentId, type: "PURCHASE", orderId, lessonCount: lessons, createdAt: now, operatorId: options.operatorId || "SYSTEM" } }); } else entitlementId = existing._id; }
      await transaction.collection("students").doc(order.studentId).update({ data: { remainingLessons: balance, totalLessons: Number(student.totalLessons || 0) + lessons, updatedAt: now } }); await transaction.collection("lessonLedger").add({ data: { studentId: order.studentId, entitlementId, type: "purchase", delta: lessons, balanceAfter: balance, referenceType: "order", referenceId: orderId, note: `${(order.packageSnapshot || {}).packageName || order.courseTypeName}订单到账`, createdAt: now, operatorId: options.operatorId || "SYSTEM" } });
      if ((options.paymentMethod || "") === "WECHAT_PAY") { const verified = options.verifiedPayment || {}; await transaction.collection("payments").add({ data: { orderId, orderNo: order.orderNo, studentId: order.studentId, userId: order.userId, paymentMethod: "WECHAT_PAY", transactionId: options.transactionId, amountFen: Number(verified.amountFen || order.payableAmount), currency: verified.currency || "CNY", status: "SUCCESS", source: "SETTLED", createdAt: now, updatedAt: now } }); await transaction.collection("auditLogs").add({ data: { userId: "SYSTEM", role: "system", action: "WECHAT_PAYMENT_SETTLED", targetType: "order", targetId: orderId, orderId, orderNo: order.orderNo, studentId: order.studentId, transactionId: options.transactionId, amountFen: Number(verified.amountFen || order.payableAmount), source: options.source || "ACTIVE_QUERY", operator: "SYSTEM", createdAt: now } }); }
      else if (["OFFLINE_TRANSFER", "CASH", "ADMIN_ADJUSTMENT"].includes(options.paymentMethod)) await transaction.collection("payments").add({ data: { orderId, orderNo: order.orderNo, studentId: order.studentId, userId: order.userId, paymentMethod: options.paymentMethod, transactionId: "", amountFen: Number(order.payableAmount || 0), currency: "CNY", status: "SUCCESS", source: "ADMIN_OFFLINE", operatorId: options.operatorId, createdAt: now, updatedAt: now } });
      if (order.couponId) { await transaction.collection("couponRedemptions").add({ data: { couponId: order.couponId, couponCode: order.couponCode, userId: order.userId, orderId, createdAt: now } }); await transaction.collection("coupons").doc(order.couponId).update({ data: { usedCount: command.inc(1), updatedAt: now } }); } settled = true; });
    return { ok: true, settled };
  }

  async function confirmOrderPayment(user, input) {
    requireRole(user, ["admin"]); const orderId = String(input.id || ""); const order = (await db.collection("orders").doc(orderId).get()).data; if (!order) throw new Error("订单不存在");
    if (order.paymentMethod === "WECHAT_PAY") { const error = new Error("微信支付订单禁止人工确认到账"); error.code = "WECHAT_PAYMENT_MANUAL_SETTLEMENT_FORBIDDEN"; throw error; }
    const paymentMethod = String(input.paymentMethod || ""); if (!["OFFLINE_TRANSFER", "CASH", "ADMIN_ADJUSTMENT"].includes(paymentMethod)) throw new Error("请选择正式的线下支付方式");
    const note = String(input.note || "").trim(); if (!note) throw new Error("人工到账必须填写备注");
    const result = await settleOrder(orderId, { paymentMethod, operatorId: user._id });
    await audit(user, "CONFIRM_OFFLINE_ORDER_PAYMENT", "order", orderId, { paymentMethod, note, operatorId: user._id }); return { ok: true, idempotent: !result.settled };
  }

  async function applyLessonDeltaInTransaction(transaction, user, session, studentId, delta, context = {}) {
    const now = nowText(), effectiveDate = dateText(session.date || now); const student = (await transaction.collection("students").doc(studentId).get()).data;
    if (!student) throw new Error("学员不存在");
    let entitlementId = context.entitlementId || "", entitlement = null;
    if (delta < 0) {
      const rows = (await transaction.collection("lessonEntitlements").where({ studentId }).limit(100).get()).data;
      for (const item of rows.filter((row) => row.status === "ACTIVE" && row.expiresAt && row.expiresAt < effectiveDate && Number(row.remainingLessons || 0) > 0)) {
        await transaction.collection("lessonEntitlements").doc(item._id).update({ data: { status: "EXPIRED", expiredAt: effectiveDate, updatedAt: now } });
        await transaction.collection("lessonEntitlementEvents").add({ data: { entitlementId: item._id, studentId, type: "EXPIRE", remainingLessons: Number(item.remainingLessons || 0), effectiveDate, createdAt: now, operatorId: "SYSTEM" } });
        await transaction.collection("lessonLedger").add({ data: { studentId, entitlementId: item._id, type: "expiry", delta: -Number(item.remainingLessons || 0), balanceAfter: Math.max(0, Number(student.remainingLessons || 0) - Number(item.remainingLessons || 0)), referenceType: "entitlement", referenceId: item._id, note: `${item.packageNameSnapshot || "课时套餐"}已到期，剩余课时停止使用`, createdAt: now, operatorId: "SYSTEM" } });
        student.remainingLessons = Math.max(0, Number(student.remainingLessons || 0) - Number(item.remainingLessons || 0));
      }
      const available = rows.filter((row) => Number(row.remainingLessons || 0) > 0 && (row.status === "UNACTIVATED" || row.status === "ACTIVE" && (!row.expiresAt || row.expiresAt >= effectiveDate))).sort((a, b) => { const ar = a.status === "ACTIVE" ? 0 : 1, br = b.status === "ACTIVE" ? 0 : 1; return ar - br || String(a.expiresAt || a.createdAt).localeCompare(String(b.expiresAt || b.createdAt)); });
      entitlement = available[0] || null;
      if (entitlement) {
        entitlementId = entitlement._id; const update = { remainingLessons: Number(entitlement.remainingLessons || 0) - 1, updatedAt: now };
        if (entitlement.status === "UNACTIVATED") { update.status = update.remainingLessons ? "ACTIVE" : "EXHAUSTED"; update.activatedAt = effectiveDate; update.expiresAt = addDays(addMonths(effectiveDate, entitlement.validityMonthsSnapshot), entitlement.extensionDays || 0); await transaction.collection("lessonEntitlementEvents").add({ data: { entitlementId, studentId, type: "ACTIVATE", activatedAt: effectiveDate, expiresAt: update.expiresAt, validityMonthsSnapshot: Number(entitlement.validityMonthsSnapshot || 0), extensionDays: Number(entitlement.extensionDays || 0), sourceSessionId: session._id, createdAt: now, operatorId: user._id } }); }
        else if (!update.remainingLessons) update.status = "EXHAUSTED";
        await transaction.collection("lessonEntitlements").doc(entitlementId).update({ data: update });
      } else if (Number(student.remainingLessons || 0) <= 0) throw new Error("没有可用课时权益，请先购买或联系管理员处理");
    } else if (delta > 0 && entitlementId) {
      entitlement = (await transaction.collection("lessonEntitlements").doc(entitlementId).get().catch(() => ({ data: null }))).data;
      if (entitlement) await transaction.collection("lessonEntitlements").doc(entitlementId).update({ data: { remainingLessons: Number(entitlement.remainingLessons || 0) + delta, status: entitlement.activatedAt ? "ACTIVE" : "UNACTIVATED", updatedAt: now } });
    }
    const balance = Math.max(0, Number(student.remainingLessons || 0) + delta); await transaction.collection("students").doc(studentId).update({ data: { remainingLessons: balance, updatedAt: now } });
    await transaction.collection("lessonLedger").add({ data: { studentId, entitlementId, type: context.ledgerType || (delta < 0 ? "attendance" : "attendance_adjustment"), delta, balanceAfter: balance, referenceType: "session", referenceId: session._id, note: context.note || `${session.title}课时变动`, createdAt: now, operatorId: user._id, leaveRequestId: context.leaveRequestId || "" } });
    return { balance, entitlementId };
  }

  async function listLessonEntitlements(user, input) {
    requireRole(user, ["admin", "parent"]); const studentId = String(input.studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : "")); await assertStudentAccess(user, studentId);
    const currentDate = dateText(nowText());
    for (const candidate of (await fetchAll("lessonEntitlements", { studentId })).filter((item) => item.status === "ACTIVE" && item.expiresAt && item.expiresAt < currentDate && Number(item.remainingLessons || 0) > 0)) await db.runTransaction(async (transaction) => {
      const item = (await transaction.collection("lessonEntitlements").doc(candidate._id).get().catch(() => ({ data: null }))).data; if (!item || item.status !== "ACTIVE" || !item.expiresAt || item.expiresAt >= currentDate) return;
      const student = (await transaction.collection("students").doc(studentId).get()).data, remaining = Number(item.remainingLessons || 0), balance = Math.max(0, Number(student.remainingLessons || 0) - remaining), now = nowText();
      await transaction.collection("lessonEntitlements").doc(item._id).update({ data: { status: "EXPIRED", expiredAt: currentDate, updatedAt: now } });
      await transaction.collection("students").doc(studentId).update({ data: { remainingLessons: balance, updatedAt: now } });
      await transaction.collection("lessonEntitlementEvents").add({ data: { entitlementId: item._id, studentId, type: "EXPIRE", remainingLessons: remaining, effectiveDate: currentDate, createdAt: now, operatorId: "SYSTEM" } });
      await transaction.collection("lessonLedger").add({ data: { studentId, entitlementId: item._id, type: "expiry", delta: 0, balanceAfter: balance, referenceType: "entitlement", referenceId: item._id, note: `${item.packageNameSnapshot || "课时套餐"}已到期，保留${remaining}节历史记录但停止使用`, createdAt: now, operatorId: "SYSTEM" } });
    });
    const rows = await fetchAll("lessonEntitlements", { studentId });
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ id: item._id, studentId, orderId: item.orderId, packageName: item.packageNameSnapshot, purchasedLessons: Number(item.purchasedLessons || 0), remainingLessons: Number(item.remainingLessons || 0), status: item.status, statusLabel: item.status === "UNACTIVATED" ? "未激活" : item.status === "ACTIVE" ? "使用中" : item.status === "EXPIRED" ? "已到期" : "已用完", validityMonthsSnapshot: Number(item.validityMonthsSnapshot || 0), extensionDays: Number(item.extensionDays || 0), activatedAt: item.activatedAt || "", expiresAt: item.expiresAt || "", validityMessage: item.activatedAt ? `有效期至 ${item.expiresAt}` : "有效期将在首次正式训练消课后开始计算" }));
  }

  async function extendLessonEntitlement(user, input) {
    requireRole(user, ["admin"]); const extensionDays = Number(input.extensionDays || 0), reason = String(input.reason || "").trim(); if (!Number.isInteger(extensionDays) || extensionDays <= 0 || !reason) throw new Error("请填写正整数延期天数和延期原因"); const id = String(input.entitlementId || ""); const now = nowText();
    const result = await db.runTransaction(async (transaction) => { const item = (await transaction.collection("lessonEntitlements").doc(id).get()).data; if (!item) throw new Error("课时权益不存在"); const oldExpiresAt = item.expiresAt || "", oldStatus = item.status, extensionDaysTotal = Number(item.extensionDays || 0) + extensionDays; let expiresAt = oldExpiresAt, status = oldStatus, restoreLessons = 0;
      if (item.activatedAt) { expiresAt = addDays(oldExpiresAt || addMonths(item.activatedAt, item.validityMonthsSnapshot), extensionDays); if (oldStatus === "EXPIRED" && expiresAt >= dateText(now) && Number(item.remainingLessons || 0) > 0) { status = "ACTIVE"; restoreLessons = Number(item.remainingLessons || 0); const student = (await transaction.collection("students").doc(item.studentId).get()).data; const balance = Number(student.remainingLessons || 0) + restoreLessons; await transaction.collection("students").doc(item.studentId).update({ data: { remainingLessons: balance, updatedAt: now } }); await transaction.collection("lessonLedger").add({ data: { studentId: item.studentId, entitlementId: id, type: "validity_reactivation", delta: restoreLessons, balanceAfter: balance, referenceType: "entitlement", referenceId: id, note: `管理员延期后恢复${restoreLessons}节可用课时`, createdAt: now, operatorId: user._id } }); } }
      await transaction.collection("lessonEntitlements").doc(id).update({ data: { extensionDays: extensionDaysTotal, expiresAt, status, updatedAt: now } }); const adjustment = { entitlementId: id, studentId: item.studentId, type: "EXTEND_VALIDITY", oldExpiresAt, extensionDays, newExpiresAt: expiresAt, reason, operatorId: user._id, createdAt: now }; await transaction.collection("lessonEntitlementAdjustments").add({ data: adjustment }); await transaction.collection("lessonEntitlementEvents").add({ data: adjustment }); return { oldExpiresAt, newExpiresAt: expiresAt, status, restoreLessons }; });
    await audit(user, "EXTEND_LESSON_ENTITLEMENT", "lessonEntitlement", id, { extensionDays, reason, ...result }); return { ok: true, ...result };
  }

  async function adjustStudentLessons(user, input) {
    requireRole(user, ["admin"]); const studentId = String(input.studentId || ""), delta = Number(input.delta || 0), reason = String(input.reason || "").trim(); if (!Number.isInteger(delta) || !delta || !reason) throw new Error("请填写整数课时调整值和原因");
    const balance = await db.runTransaction(async (transaction) => { const student = (await transaction.collection("students").doc(studentId).get()).data; if (!student) throw new Error("学员不存在"); const next = Number(student.remainingLessons || 0) + delta; if (next < 0) throw new Error("调整后可用课时不能小于0"); await transaction.collection("students").doc(studentId).update({ data: { remainingLessons: next, totalLessons: delta > 0 ? Number(student.totalLessons || 0) + delta : Number(student.totalLessons || 0), updatedAt: nowText() } }); await transaction.collection("lessonLedger").add({ data: { studentId, type: "admin_adjustment", delta, balanceAfter: next, referenceType: "admin", referenceId: user._id, note: reason, createdAt: nowText(), operatorId: user._id } }); return next; }); await audit(user, "ADJUST_STUDENT_LESSONS", "student", studentId, { delta, reason, balanceAfter: balance }); return { ok: true, balanceAfter: balance };
  }

  async function compensateSessionCancellation(user, session, input, affectedStudentIds) {
    requireRole(user, ["admin"]); const compensationType = String(input.compensationType || "NO_COMPENSATION"), extensionDays = compensationType === "EXTEND_VALIDITY" ? Math.max(1, Number(input.extensionDays || 7)) : 0, now = nowText();
    const compensationId = `session_${session._id}`;
    return db.runTransaction(async (transaction) => {
      const existing = (await transaction.collection("sessionCancellationCompensations").doc(compensationId).get().catch(() => ({ data: null }))).data;
      if (existing) return { ...publicDoc(existing), idempotent: true };
      const affected = [...new Set(affectedStudentIds || [])], adjustments = [];
      if (compensationType === "EXTEND_VALIDITY") for (const studentId of affected) {
        const currentDate = dateText(now), rows = (await transaction.collection("lessonEntitlements").where({ studentId }).limit(100).get()).data.filter((item) => Number(item.remainingLessons || 0) > 0 && (item.status === "UNACTIVATED" || item.status === "ACTIVE" && (!item.expiresAt || item.expiresAt >= currentDate))).sort((a, b) => { const ar = a.status === "ACTIVE" ? 0 : 1, br = b.status === "ACTIVE" ? 0 : 1; return ar - br || String(a.expiresAt || a.createdAt).localeCompare(String(b.expiresAt || b.createdAt)); });
        const item = rows[0]; if (!item) continue; const oldExpiresAt = item.expiresAt || "", newExpiresAt = item.status === "ACTIVE" ? addDays(item.expiresAt, extensionDays) : "", nextExtensionDays = Number(item.extensionDays || 0) + extensionDays;
        await transaction.collection("lessonEntitlements").doc(item._id).update({ data: { extensionDays: nextExtensionDays, expiresAt: newExpiresAt, updatedAt: now } });
        const adjustment = { entitlementId: item._id, studentId, type: "SESSION_CANCEL_VALIDITY_EXTENSION", oldExpiresAt, extensionDays, newExpiresAt, reason: String(input.reasonCode || "CLUB"), sourceSessionId: session._id, operatorId: user._id, createdAt: now }; await transaction.collection("lessonEntitlementAdjustments").add({ data: adjustment }); await transaction.collection("lessonEntitlementEvents").add({ data: adjustment }); await transaction.collection("lessonLedger").add({ data: { studentId, entitlementId: item._id, type: "validity_extension", delta: 0, balanceAfter: Number(((await transaction.collection("students").doc(studentId).get()).data || {}).remainingLessons || 0), referenceType: "session", referenceId: session._id, note: `${String(input.reasonLabel || "课程取消")}，本次未扣课，有效期顺延${extensionDays}天`, createdAt: now, operatorId: user._id } }); adjustments.push(adjustment);
      }
      const record = { sessionId: session._id, classId: session.classId, reasonCode: input.reasonCode, reason: input.reason, compensationType, extensionDays, replacementSessionId: String(input.replacementSessionId || ""), affectedStudentIds: affected, adjustmentCount: adjustments.length, status: "APPLIED", operatorId: user._id, createdAt: now };
      await transaction.collection("sessionCancellationCompensations").doc(compensationId).set({ data: record }); return { id: compensationId, ...record, adjustments, idempotent: false };
    });
  }

  function maskIdentifier(value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.length <= 8) return "****";
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
  }

  function paymentReady() {
    const result = paymentEnvironmentCheck(); const readiness = paymentReadiness();
    const fieldNames = ["WECHAT_PAY_APPID", "WECHAT_PAY_MCHID", "WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_SERIAL_NO", "WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PUBLIC_KEY", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_NOTIFY_URL", "PAYMENT_PRODUCTION_ENABLED"];
    const fields = Object.fromEntries(fieldNames.map((name) => [name, !result.missing.includes(name)]));
    return { status: result.status, missing: result.missing, fields, appIdMatches: readiness.appIdMatches, productionEnabled: readiness.productionEnabled };
  }

  async function paymentDiagnostics(user) {
    requireRole(user, ["admin"]); await ensureDefaults();
    const [payments, orders, packages] = await Promise.all([fetchAll("payments"), fetchAll("orders"), fetchAll("coursePackages")]);
    const recentPayments = payments.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const latest = recentPayments[0] || null;
    const testPackage = packages.find((item) => item.packageCode === "PAYMENT_TEST_1") || null;
    const testOrders = orders.filter((item) => Boolean((item.packageSnapshot || {}).isPaymentTest) || (item.packageSnapshot || {}).packageCode === "PAYMENT_TEST_1").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
    const students = await fetchByIds("students", testOrders.map((item) => item.studentId));
    return {
      environment: paymentReady(),
      latestPayment: latest ? { orderNo: latest.orderNo || "", status: latest.status || "", source: latest.source || "", transactionIdMasked: maskIdentifier(latest.transactionId), createdAt: latest.createdAt || "" } : null,
      testPackage: testPackage ? { id: testPackage._id, name: testPackage.name, lessonCount: Number(testPackage.lessonCount || 0), priceFen: Number(testPackage.priceFen || 0), priceYuan: (Number(testPackage.priceFen || 0) / 100).toFixed(2), validityMonths: Number(testPackage.validityMonths || 0), status: testPackage.status } : null,
      testOrders: testOrders.map((item) => ({ id: item._id, orderNo: item.orderNo, studentName: (students.find((student) => student._id === item.studentId) || {}).name || "", amountFen: Number(item.payableAmount || 0), orderStatus: item.status, paymentStatus: item.paymentStatus, createdAt: item.createdAt || "" })),
    };
  }

  async function paymentOrderDiagnostics(user, input) {
    requireRole(user, ["admin"]); const id = String(input.id || ""); const orderNo = String(input.orderNo || "");
    let order = id ? (await db.collection("orders").doc(id).get().catch(() => ({ data: null }))).data : null;
    if (!order && orderNo) order = (await db.collection("orders").where({ orderNo }).limit(1).get()).data[0];
    if (!order) throw new Error("测试订单不存在");
    const [studentResult, payments] = await Promise.all([db.collection("students").doc(order.studentId).get().catch(() => ({ data: null })), fetchAll("payments", { orderId: order._id })]);
    return {
      order: { id: order._id, orderNo: order.orderNo, student: (studentResult.data || {}).name || "", package: (order.packageSnapshot || {}).packageName || order.courseTypeName || "", amountFen: Number(order.payableAmount || 0), orderStatus: order.status, paymentStatus: order.paymentStatus, transactionIdMasked: maskIdentifier(order.transactionId), createdAt: order.createdAt || "", paidAt: order.paidAt || "" },
      events: payments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((item) => ({ source: item.source || "", status: item.status || "", errorCode: item.errorCode || "", transactionIdMasked: maskIdentifier(item.transactionId), createdAt: item.createdAt || "" })),
    };
  }

  async function paymentAcceptanceCheck(user, input) {
    requireRole(user, ["admin"]); const id = String(input.id || ""); const order = (await db.collection("orders").doc(id).get().catch(() => ({ data: null }))).data;
    if (!order) throw new Error("测试订单不存在");
    const [payments, entitlements, ledgers, audits, studentResult] = await Promise.all([fetchAll("payments", { orderId: id }), fetchAll("lessonEntitlements", { orderId: id }), fetchAll("lessonLedger", { referenceType: "order", referenceId: id }), fetchAll("auditLogs", { orderId: id }), db.collection("students").doc(order.studentId).get().catch(() => ({ data: null }))]);
    const expectedLessons = Number((order.packageSnapshot || {}).lessonCount || order.lessons || 0); const student = studentResult.data;
    const settledPayment = payments.find((item) => item.source === "SETTLED" && item.status === "SUCCESS");
    const entitlement = entitlements.find((item) => Number(item.purchasedLessons || 0) === expectedLessons);
    const purchaseLedger = ledgers.find((item) => item.type === "purchase" && Number(item.delta || 0) === expectedLessons);
    const allStudentLedgers = await fetchAll("lessonLedger", { studentId: order.studentId });
    const latestLedger = allStudentLedgers.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const checks = [
      { key: "A_ORDER_PAID", pass: order.status === "PAID" && order.paymentStatus === "PAID", detail: order.status || "UNKNOWN" },
      { key: "B_TRANSACTION_ID", pass: Boolean(order.transactionId), detail: maskIdentifier(order.transactionId) || "缺失" },
      { key: "C_PAYMENT_SETTLED", pass: Boolean(settledPayment), detail: settledPayment ? "SETTLED / SUCCESS" : "缺失" },
      { key: "D_ENTITLEMENT", pass: Boolean(entitlement), detail: entitlement ? `${Number(entitlement.purchasedLessons || 0)}节` : "缺失" },
      { key: "E_LESSON_LEDGER", pass: Boolean(purchaseLedger), detail: purchaseLedger ? `+${Number(purchaseLedger.delta || 0)}` : "缺失" },
      { key: "F_STUDENT_BALANCE", pass: Boolean(student && latestLedger && Number(student.remainingLessons || 0) === Number(latestLedger.balanceAfter || 0)), detail: student ? `${Number(student.remainingLessons || 0)}节` : "学员缺失" },
      { key: "G_AUDIT_LOG", pass: audits.some((item) => item.action === "WECHAT_PAYMENT_SETTLED"), detail: audits.some((item) => item.action === "WECHAT_PAYMENT_SETTLED") ? "存在" : "缺失" },
    ];
    return { status: checks.every((item) => item.pass) ? "PASS" : "FAIL", orderNo: order.orderNo, checks };
  }

  async function listNotifications(user) {
    return (await fetchAll("notifications", { targetUserId: user._id })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicDoc);
  }

  async function markNotificationRead(user, input) {
    const item = (await db.collection("notifications").doc(input.id).get()).data; if (!item || item.targetUserId !== user._id) throw new Error("通知不存在"); await db.collection("notifications").doc(input.id).update({ data: { status: "READ", readAt: nowText(), updatedAt: nowText() } }); return { ok: true };
  }

  async function metrics() {
    const [orders, attendance] = await Promise.all([fetchAll("orders"), fetchAll("attendance")]); const paid = orders.filter((item) => item.status === "PAID"); const marked = attendance.filter((item) => item.status !== "unmarked"); const present = marked.filter((item) => item.status === "present");
    return { paidOrders: paid.length, revenueCents: paid.reduce((sum, item) => sum + Number(item.payableAmount || 0), 0), pendingOrders: orders.filter((item) => item.status === "PENDING_PAYMENT").length, attendanceRate: marked.length ? Math.round(present.length / marked.length * 100) : 0 };
  }

  async function call(action, input, user) {
    if (action === "registerMember") return registerMember(user, input);
    if (action === "listUsers") return listUsers(user);
    if (action === "listNews") return listNews(user, input);
    if (action === "saveNews") return saveNews(user, input);
    if (action === "listCommerceConfig") return listCommerceConfig(user);
    if (action === "saveCourseType") return saveCourseType(user, input);
    if (action === "savePricingRule") return savePricingRule(user, input);
    if (action === "saveCoupon") return saveCoupon(user, input);
    if (action === "listCatalog") return listCatalog();
    if (action === "createOrder") return createOrder(user, input);
    if (action === "listOrders") return listOrders(user);
    if (action === "confirmOrderPayment") return confirmOrderPayment(user, input);
    if (action === "getPaymentReadiness") { requireRole(user, ["admin"]); return paymentReady(); }
    if (action === "getPaymentDiagnostics") return paymentDiagnostics(user);
    if (action === "getPaymentOrderDiagnostics") return paymentOrderDiagnostics(user, input);
    if (action === "checkPaymentAcceptance") return paymentAcceptanceCheck(user, input);
    if (action === "listCoursePackages") return listCoursePackages(user);
    if (action === "saveCoursePackage") return saveCoursePackage(user, input);
    if (action === "setCoursePackageStatus") return setCoursePackageStatus(user, input);
    if (action === "listLessonEntitlements") return listLessonEntitlements(user, input);
    if (action === "extendLessonEntitlement") return extendLessonEntitlement(user, input);
    if (action === "adjustStudentLessons") return adjustStudentLessons(user, input);
    if (action === "listNotifications") return listNotifications(user);
    if (action === "markNotificationRead") return markNotificationRead(user, input);
    throw new Error("未知正式版业务操作");
  }

  return { handles: (action) => ACTIONS.has(action), call, ensureDefaults, notify, metrics, paymentReady, payableOrder, settleOrder, verifyAndSettleWechatPayment, recordPaymentEvent, updatePaymentEvent, latestPaymentAttempt, replaceClosedWechatOrder, markWechatOrderClosed, paymentSecurityLog, applyLessonDeltaInTransaction, compensateSessionCancellation };
}

module.exports = { createBusinessService };
