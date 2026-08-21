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
  "listNotifications",
  "markNotificationRead",
]);

function createBusinessService({ db, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit, assertStudentAccess, firstOwnedStudentId }) {
  const command = db.command;

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
  }

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
    return (await fetchAll("users")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ id: item._id, name: item.name || "未填写姓名", mobile: item.mobile || "", role: item.role, classIds: item.classIds || [], studentIds: item.studentIds || [], createdAt: item.createdAt || "" }));
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
    const rule = (await db.collection("pricingRules").doc(input.pricingRuleId).get()).data; if (!rule || rule.status !== "ACTIVE") throw new Error("价格规则已失效");
    const type = (await db.collection("courseTypes").doc(rule.courseTypeId).get()).data; if (!type || type.status !== "ACTIVE") throw new Error("课程类型已停用");
    const originalAmount = Number(rule.amount || 0); const { coupon, discountAmount } = await couponDiscount(user, input.couponCode, originalAmount); const payableAmount = Math.max(0, originalAmount - discountAmount); const now = nowText(); const orderNo = code("NL");
    const added = await db.collection("orders").add({ data: { orderNo, userId: user._id, studentId, pricingRuleId: rule._id, coachId: rule.coachId, courseTypeId: type._id, courseTypeName: type.name, lessons: Number(type.lessons || 0), originalAmount, discountAmount, payableAmount, couponId: coupon ? coupon._id : "", couponCode: coupon ? coupon.code : "", status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paymentMethod: "WECHAT_PAY", createdAt: now, updatedAt: now } });
    await audit(user, "CREATE_ORDER", "order", added._id, { orderNo, payableAmount }); return { id: added._id, orderNo, payableAmount, amountYuan: (payableAmount / 100).toFixed(2), paymentConfigured: paymentReady().configured };
  }

  async function listOrders(user) {
    let rows = await fetchAll("orders"); if (user.role === "parent") rows = rows.filter((item) => item.userId === user._id); if (user.role === "coach") rows = rows.filter((item) => item.coachId === user._id);
    const students = await fetchByIds("students", rows.map((item) => item.studentId)); return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ ...publicDoc(item), studentName: (students.find((student) => student._id === item.studentId) || {}).name || "", amountYuan: (Number(item.payableAmount || 0) / 100).toFixed(2) }));
  }

  async function payableOrder(user, id) {
    const order = (await db.collection("orders").doc(id).get()).data; if (!order) throw new Error("订单不存在");
    if (user.role === "parent" && order.userId !== user._id) throw new Error("无权支付该订单");
    if (user.role === "coach") throw new Error("教练不能支付学员订单");
    if (order.status === "PAID") return order;
    if (order.status !== "PENDING_PAYMENT") throw new Error("订单当前不可支付");
    return order;
  }

  async function settleOrder(orderId, options = {}) {
    const now = nowText(); let settled = false;
    await db.runTransaction(async (transaction) => { const order = (await transaction.collection("orders").doc(orderId).get()).data; if (!order) throw new Error("订单不存在"); if (order.status === "PAID") return; if (order.status !== "PENDING_PAYMENT") throw new Error("订单状态无法确认"); const student = (await transaction.collection("students").doc(order.studentId).get()).data; const balance = Number(student.remainingLessons || 0) + Number(order.lessons || 0); await transaction.collection("orders").doc(orderId).update({ data: { status: "PAID", paymentStatus: "PAID", paymentMethod: options.paymentMethod || "WECHAT_PAY", transactionId: options.transactionId || "", paidAt: now, operatorId: options.operatorId || "SYSTEM", updatedAt: now } }); await transaction.collection("students").doc(order.studentId).update({ data: { remainingLessons: balance, totalLessons: Number(student.totalLessons || 0) + Number(order.lessons || 0), updatedAt: now } }); await transaction.collection("lessonLedger").add({ data: { studentId: order.studentId, type: "purchase", delta: Number(order.lessons || 0), balanceAfter: balance, referenceType: "order", referenceId: orderId, note: `${order.courseTypeName}订单到账`, createdAt: now, operatorId: options.operatorId || "SYSTEM" } }); if (order.couponId) { await transaction.collection("couponRedemptions").add({ data: { couponId: order.couponId, couponCode: order.couponCode, userId: order.userId, orderId, createdAt: now } }); await transaction.collection("coupons").doc(order.couponId).update({ data: { usedCount: command.inc(1), updatedAt: now } }); } settled = true; });
    return { ok: true, settled };
  }

  async function confirmOrderPayment(user, input) {
    requireRole(user, ["admin"]); const orderId = String(input.id || ""); await settleOrder(orderId, { paymentMethod: input.paymentMethod || "MANUAL", operatorId: user._id });
    await audit(user, "CONFIRM_ORDER_PAYMENT", "order", orderId, { paymentMethod: input.paymentMethod || "MANUAL" }); return { ok: true };
  }

  function paymentReady() {
    const required = ["WECHAT_PAY_APPID", "WECHAT_PAY_MCHID", "WECHAT_PAY_SERIAL_NO", "WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PUBLIC_KEY", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_NOTIFY_URL"];
    const missing = required.filter((name) => !process.env[name]); return { configured: missing.length === 0, missing };
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
    if (action === "listNotifications") return listNotifications(user);
    if (action === "markNotificationRead") return markNotificationRead(user, input);
    throw new Error("未知正式版业务操作");
  }

  return { handles: (action) => ACTIONS.has(action), call, ensureDefaults, notify, metrics, paymentReady, payableOrder, settleOrder };
}

module.exports = { createBusinessService };
