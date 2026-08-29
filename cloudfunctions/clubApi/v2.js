const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const { createClassService } = require("./class-service");
const { createFamilyService } = require("./family-service");
const { createBusinessService } = require("./business-service");
const { createPaymentService } = require("./payment-service");
const { createCoachService } = require("./coach-service");
const { createCoachBindingService } = require("./coach-binding-service");
const { createCoachWorkService } = require("./coach-work-service");
const { createTimetableService } = require("./timetable-service");
const { createCrmService } = require("./crm-service");
const { createTrainingService } = require("./training-service");
const { createGrowthService } = require("./growth-service");
const { createLeagueService } = require("./league-service");
const { ACCOUNT_STATES, accountState, publicAuthUser, assertActiveUser } = require("./auth-policy");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;

const openidList = (name) => String(process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
// 在云函数环境变量中配置真实管理员，避免“第一个访问者自动成为管理员”。
const BOOTSTRAP_ADMIN_OPENIDS = openidList("BOOTSTRAP_ADMIN_OPENIDS");
// 仅用于测试环境；正式发布前删除该环境变量并重新部署云函数。
const TEST_ROLE_SWITCH_OPENIDS = openidList("TEST_ROLE_SWITCH_OPENIDS");
// 开发验收账号只保存 OPENID 的单向摘要，避免把原始 OPENID 写入代码仓库。
// 正式发布前应清空本列表，并仅通过 TEST_ROLE_SWITCH_OPENIDS 临时授权测试账号。
const TEST_ROLE_SWITCH_OPENID_HASHES = new Set([
  "32907fe66e3e35da94511a745d7ba2ea983d825a746d6fc26772264a94b9193a",
  "f83aaadf5a5d5222157d34ac94bbd6dd20acff156ee037bdcd43ef8c6766a7b8",
]);
const COLLECTIONS = ["users", "students", "studentPrivateProfiles", "parentStudentLinks", "childProfileRequests", "classes", "classMembers", "eliteSelections", "sessions", "coachSessionRecords", "matches", "matchSquads", "teams", "teamMembers", "externalPlayers", "leagues", "leagueSeasons", "leagueRounds", "seasonTeams", "leaveRequests", "attendance", "lessonLedger", "lessonEntitlements", "lessonEntitlementEvents", "lessonEntitlementAdjustments", "sessionCancellationCompensations", "coursePackages", "invites", "coachInvites", "auditLogs", "notifications", "news", "courseTypes", "pricingRules", "coupons", "couponRedemptions", "orders", "payments", "paymentTransactionClaims", "paymentSecurityLogs", "coachProfiles", "leads", "leadFollowUps", "trialBookings", "curriculums", "weeklyTrainingPlans", "feedback", "assessmentTemplates", "assessmentRounds", "playerAssessments", "playerGrowthEvents", "playerMatchRecords"];
const DEDUCTION = { present: 1, absent: 1, leave: 0, sick: 0 };
let coachBindingService;
const coachService = createCoachService({ db, fetchAll, nowText, requireRole, audit, getBindingView: (profile) => coachBindingService.decorateProfile(profile) });
coachBindingService = createCoachBindingService({ db, fetchAll, nowText, requireRole, audit, findUser, isLegacyPlaceholder, identityHash, createQrCode: createCoachInviteQr });
const timetableService = createTimetableService({ fetchAll, todayText, requireRole, getCoachReference: coachService.getReference });
const classService = createClassService({ db, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit, getCoachReference: coachService.getReference });
const familyService = createFamilyService({ db, command, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit });
const businessService = createBusinessService({ db, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit, assertStudentAccess, firstOwnedStudentId });
const coachWorkService = createCoachWorkService({ db, fetchAll, fetchByIds, publicDoc, nowText, todayText, requireRole, audit, getCoachReference: coachService.getReference, businessService, getActiveClassMembers: classService.activeMembers });
const paymentService = createPaymentService({ businessService });
const crmService = createCrmService({ db, command, fetchAll, fetchByIds, publicDoc, nowText, todayText, requireRole, audit, saveStudent, canManageSession: sessionAccess });
const trainingService = createTrainingService({ db, fetchAll, publicDoc, nowText, requireRole, audit, assertStudentAccess });
const growthService = createGrowthService({ db, command, fetchAll, fetchByIds, publicDoc, nowText, todayText, requireRole, audit, assertStudentAccess });
const leagueService = createLeagueService({ db, fetchAll, fetchByIds, publicDoc, nowText, todayText, requireRole, audit, allowedStudentIds, assertStudentAccess, getCoachReference: coachService.getReference });
let collectionsReady;

function nowText() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16); }
function todayText() { return nowText().slice(0, 10); }
function publicDoc(doc) { if (!doc) return doc; const value = { ...doc, id: doc._id }; delete value._id; delete value.openid; delete value.idCardNumber; delete value.idCard; return value; }
function requireRole(user, roles) { if (!roles.includes(user.role)) throw new Error("没有执行该操作的权限"); }
function validId(id) { if (!id || typeof id !== "string") throw new Error("请求参数无效"); return id; }
function canSwitchTestRole(openid) {
  const digest = identityHash(openid);
  return TEST_ROLE_SWITCH_OPENIDS.includes(openid) || TEST_ROLE_SWITCH_OPENID_HASHES.has(digest);
}
function identityHash(openid) { return crypto.createHash("sha256").update(String(openid || "")).digest("hex"); }
function userDocumentId(openid) { return `wx_${identityHash(openid).slice(0, 28)}`; }
async function createCoachInviteQr(inviteId, scene) {
  const result = await cloud.openapi.wxacode.getUnlimited({ scene, page: "pages/coach-bind/index", checkPath: false, envVersion: "trial", width: 430 });
  if (!result || !result.buffer) throw new Error("微信二维码接口未返回图片");
  const uploaded = await cloud.uploadFile({ cloudPath: `coach-invites/${inviteId}.png`, fileContent: result.buffer });
  if (!uploaded || !uploaded.fileID) throw new Error("二维码上传云存储失败");
  return uploaded.fileID;
}

async function ensureCollections() {
  if (!collectionsReady) collectionsReady = Promise.all(COLLECTIONS.map(async (name) => { try { await db.createCollection(name); } catch (error) { if (!String(error.errMsg || error.message || "").includes("exist")) console.warn(`collection ${name}`, error); } }));
  await collectionsReady;
}
async function fetchAll(name, where) {
  const rows = []; let skip = 0;
  while (true) { let query = db.collection(name); if (where) query = query.where(where); const result = await query.skip(skip).limit(100).get(); rows.push(...result.data); if (result.data.length < 100) break; skip += result.data.length; }
  return rows;
}
async function fetchByIds(name, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]; const rows = [];
  for (let i = 0; i < unique.length; i += 100) rows.push(...(await db.collection(name).where({ _id: command.in(unique.slice(i, i + 100)) }).get()).data);
  return rows;
}
async function findUser(openid) {
  const found = await db.collection("users").where({ openid }).limit(1).get();
  return found.data[0] || null;
}
function isLegacyPlaceholder(user) {
  return Boolean(user && user.role === "parent" && user.name === "待绑定家长" && !user.mobile && user.profileCompleted !== true && !(user.studentIds || []).length);
}
async function resolveUser(openid) {
  const existing = await findUser(openid);
  if (existing) {
    if (!isLegacyPlaceholder(existing)) return existing;
    const owned = await db.collection("students").where({ ownerParentUserId: existing._id, status: "active" }).limit(1).get();
    if (owned.data.length) return existing;
    return null;
  }
  if (!BOOTSTRAP_ADMIN_OPENIDS.includes(openid)) return null;
  const now = nowText();
  const user = { openid, role: "admin", name: "南联管理员", status: "ACTIVE", active: true, studentIds: [], classIds: [], createdAt: now, updatedAt: now, authorizationSource: "BOOTSTRAP_ADMIN_OPENIDS" };
  const userId = userDocumentId(openid);
  await db.collection("users").doc(userId).set({ data: user });
  return { ...user, _id: userId };
}
async function resolveAuthorizedMobile(phoneCode) {
  const code = String(phoneCode || "").trim();
  if (!code) return "";
  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    return String((((result || {}).phoneInfo || {}).purePhoneNumber) || "").trim();
  } catch (error) {
    const next = new Error("手机号授权失败，请重新授权或手动填写手机号");
    next.code = "PHONE_AUTH_FAILED";
    throw next;
  }
}
async function registerParent(openid, input) {
  const existing = await findUser(openid);
  const legacyPlaceholder = isLegacyPlaceholder(existing) && !(await db.collection("students").where({ ownerParentUserId: existing._id, status: "active" }).limit(1).get()).data.length;
  if (existing && !legacyPlaceholder) {
    assertActiveUser(existing);
    if (existing.role !== "parent") throw new Error("当前微信已绑定工作人员账号，不能注册为家长");
    return { accountState: ACCOUNT_STATES.ACTIVE, user: publicAuthUser(existing), created: false };
  }
  const name = String(input.name || "").trim();
  const mobile = await resolveAuthorizedMobile(input.phoneCode) || String(input.mobile || "").trim();
  if (!name) throw new Error("请填写家长姓名");
  if (!/^1\d{10}$/.test(mobile)) throw new Error("请填写正确的手机号码");
  const now = nowText();
  const user = { openid, role: "parent", name, mobile, status: "ACTIVE", active: true, studentIds: [], classIds: [], profileCompleted: true, registrationSource: "PARENT_SELF_REGISTER", createdAt: now, updatedAt: now };
  let created;
  if (legacyPlaceholder) {
    await db.collection("users").doc(existing._id).update({ data: { ...user, createdAt: existing.createdAt || now, upgradedFromLegacyPlaceholder: true } });
    created = { ...existing, ...user };
  } else {
    const userId = userDocumentId(openid);
    await db.collection("users").doc(userId).set({ data: user });
    created = { ...user, _id: userId };
  }
  await audit(created, "REGISTER_PARENT_ACCOUNT", "user", created._id, { registrationSource: user.registrationSource, upgradedFromLegacyPlaceholder: legacyPlaceholder });
  return { accountState: ACCOUNT_STATES.ACTIVE, user: publicAuthUser(created), created: true };
}
async function audit(user, action, targetType, targetId, detail) {
  const fields = detail && typeof detail === "object" ? detail : { detail: String(detail || "") };
  await db.collection("auditLogs").add({ data: { userId: user._id, role: user.role, action, targetType, targetId, ...fields, createdAt: nowText() } });
}
async function allowedStudentIds(user) {
  if (user.role === "admin") return null;
  if (user.role === "parent") return (await fetchAll("students", { ownerParentUserId: user._id, status: "active" })).map((item) => item._id);
  const memberships = await fetchAll("classMembers", { status: "ACTIVE" });
  return [...new Set(memberships.filter((item) => (user.classIds || []).includes(item.classId)).map((item) => item.studentId))];
}
async function assertStudentAccess(user, studentId) { if (user.role === "parent") { const student = (await db.collection("students").doc(studentId).get().catch(() => ({ data: null }))).data; if (!student || student.ownerParentUserId !== user._id) throw new Error("无权访问该学员"); return; } const allowed = await allowedStudentIds(user); if (allowed && !allowed.includes(studentId)) throw new Error("无权访问该学员"); }
async function firstOwnedStudentId(user) { const allowed = await allowedStudentIds(user); return allowed && allowed[0] || ""; }

async function listStudents(user) {
  const allowed = await allowedStudentIds(user); if (allowed && !allowed.length) return [];
  const students = allowed === null ? await fetchAll("students", { status: "active" }) : (await fetchByIds("students", allowed)).filter((item) => item.status === "active");
  const [classes, memberships] = await Promise.all([fetchAll("classes"), fetchAll("classMembers", { status: "ACTIVE" })]);
  return students.map((student) => {
    const classIds = memberships.filter((item) => item.studentId === student._id).map((item) => item.classId);
    const ownClasses = classes.filter((item) => classIds.includes(item._id) && item.status !== "INACTIVE");
    return { ...publicDoc(student), initial: student.name ? student.name[0] : "学", classIds, classNames: ownClasses.map((item) => item.name).join("、"), classes: ownClasses.map((item) => ({ id: item._id, name: item.name, classType: item.classType || "REGULAR", classTypeLabel: item.classType === "ELITE" ? "精英队" : "普通班", schedule: item.schedule || "", venue: item.venue || "", memberStatus: "ACTIVE", memberStatusLabel: "正式成员" })) };
  });
}
async function ensureClassCode(clubClass) {
  if (clubClass.classCode) return clubClass.classCode;
  let value;
  do { value = `NL${String(Math.floor(100000 + Math.random() * 900000))}`; }
  while ((await db.collection("classes").where({ classCode: value }).limit(1).get()).data.length);
  await db.collection("classes").doc(clubClass._id).update({ data: { classCode: value, updatedAt: nowText() } });
  clubClass.classCode = value;
  return value;
}
async function listClasses(user, input = {}) {
  let classes;
  if (user.role === "admin") classes = await fetchAll("classes", { status: "ACTIVE" });
  else if (user.role === "coach") classes = (await fetchByIds("classes", user.classIds || [])).filter((item) => item.status !== "INACTIVE");
  else classes = await fetchAll("classes", { status: "ACTIVE" });
  for (const item of classes) await ensureClassCode(item);
  const keyword = String(input.keyword || "").trim().toLowerCase();
  const coachId = String(input.coachId || "");
  if (keyword) classes = classes.filter((item) => `${item.classCode || ""}${item.name || ""}${item.headCoachName || item.coachName || ""}`.toLowerCase().includes(keyword));
  if (coachId) classes = classes.filter((item) => (item.headCoachUserId || item.coachUserId) === coachId);
  const rows = []; for (const item of classes) rows.push(await classService.decorateClass(item)); return rows;
}
async function listClassCoaches(user) {
  requireRole(user, ["admin", "coach"]);
  if (user.role === "coach") return [{ id: user.coachId || user._id, name: user.name, accountStatus: "BOUND" }];
  const profiles = (await fetchAll("coachProfiles")).filter((item) => item.active !== false && String(item.status || "ACTIVE").toUpperCase() === "ACTIVE");
  const rows = [];
  for (const profile of profiles) { const binding = await coachBindingService.decorateProfile(profile); rows.push({ id: profile.coachUserId || profile._id, name: profile.name || "未命名教练", avatarUrl: profile.avatarUrl || "", accountStatus: binding.accountStatus }); }
  const represented = new Set(rows.map((item) => item.id));
  for (const item of (await fetchAll("users")).filter((row) => row.role === "coach" || canSwitchTestRole(row.openid))) if (!represented.has(item.coachId || item._id)) rows.push({ id: item.coachId || item._id, name: item.name || "未命名教练", accountStatus: "BOUND" });
  return rows;
}
async function getStudent(user, id) {
  await assertStudentAccess(user, id); const student = (await db.collection("students").doc(id).get()).data;
  const memberships = await classService.studentMemberships(id);
  const [classes, attendance, ledger, entitlements] = await Promise.all([
    fetchByIds("classes", memberships.map((item) => item.classId)),
    db.collection("attendance").where({ studentId: id }).orderBy("date", "desc").limit(50).get(),
    user.role === "coach" ? Promise.resolve({ data: [] }) : db.collection("lessonLedger").where({ studentId: id }).orderBy("createdAt", "desc").limit(100).get(),
    user.role === "coach" ? Promise.resolve([]) : businessService.call("listLessonEntitlements", { studentId: id }, user)
  ]);
  const decoratedClasses = []; for (const item of classes) decoratedClasses.push(await classService.decorateClass(item));
  let recruitment = null;
  const leadResult = student.crmLeadId ? await db.collection("leads").doc(student.crmLeadId).get().catch(() => ({ data: null })) : await db.collection("leads").where({ convertedStudentId: id }).limit(1).get();
  const lead = student.crmLeadId ? leadResult.data : (leadResult.data || [])[0];
  if (lead) { const trial = (await db.collection("trialBookings").where({ leadId: lead._id }).orderBy("trialDate", "desc").limit(1).get()).data[0]; recruitment = { source: lead.source || "", ownerCoachName: lead.ownerCoachName || "", firstContactAt: lead.createdAt || "", trialDate: (trial || {}).trialDate || "", trialCoachName: (trial || {}).coachName || "", trialFeedback: ((trial || {}).feedback || {}).summary || "", convertedAt: lead.convertedAt || "" }; }
  return { ...publicDoc(student), classIds: memberships.map((item) => item.classId), initial: student.name ? student.name[0] : "学", classes: decoratedClasses, memberships: memberships.map(publicDoc), attendance: attendance.data.map(publicDoc), lessonLedger: ledger.data.map(publicDoc), lessonEntitlements: entitlements, recruitment };
}
async function saveStudent(user, payload) {
  requireRole(user, ["admin"]); const requestedClassIds = payload.classIds || [];
  const existing = payload.id ? (await db.collection("students").doc(payload.id).get()).data : null;
  const data = { name: String(payload.name || "").trim(), avatarUrl: String(payload.avatarUrl || (existing || {}).avatarUrl || ""), gender: payload.gender || "男", birthDate: payload.birthDate || "", guardianName: String(payload.guardianName || "").trim(), guardianPhone: String(payload.guardianPhone || ""), emergencyContact: String(payload.emergencyContact || ""), healthNotes: String(payload.healthNotes || ""), school: String(payload.school || ""), grade: String(payload.grade || ""), registrationDate: String(payload.registrationDate || ""), crmLeadId: String(payload.crmLeadId || (existing || {}).crmLeadId || ""), source: String(payload.source || (existing || {}).source || ""), recruitmentOwnerId: String(payload.recruitmentOwnerId || (existing || {}).recruitmentOwnerId || ""), recruitmentOwnerName: String(payload.recruitmentOwnerName || (existing || {}).recruitmentOwnerName || ""), ownerParentUserId: String(payload.ownerParentUserId || (existing || {}).ownerParentUserId || ""), classIds: existing ? existing.classIds || [] : [], status: "active", updatedAt: nowText() };
  if (!data.name || !data.guardianName || !/^1\d{10}$/.test(data.guardianPhone) || !existing && !data.avatarUrl) throw new Error("请完整填写学员照片、学员和家长信息");
  let id = payload.id;
  if (id) await db.collection("students").doc(id).update({ data });
  else { const lessons = Math.max(0, Number(payload.remainingLessons || 0)); const added = await db.collection("students").add({ data: { ...data, remainingLessons: lessons, totalLessons: lessons, createdAt: nowText() } }); id = added._id; if (lessons) await db.collection("lessonLedger").add({ data: { studentId: id, type: "opening", delta: lessons, balanceAfter: lessons, referenceType: "student", referenceId: id, note: "建档期初课时", createdAt: nowText() } }); }
  if (!existing) for (const classId of requestedClassIds) await classService.call("addClassMember", { classId, studentId: id, source: "ADMIN_ADD", confirmCapacity: true }, user);
  await audit(user, "saveStudent", "student", id, data.name); return { id };
}
async function getClass(user, id) {
  requireRole(user, ["admin", "coach"]);
  const clubClass = (await db.collection("classes").doc(id).get()).data;
  if (!clubClass) throw new Error("班级不存在");
  if (user.role === "coach" && clubClass.headCoachUserId !== user._id && !(user.classIds || []).includes(id)) throw new Error("无权编辑该班级");
  return classService.decorateClass(clubClass);
}
async function saveClass(user, payload) {
  requireRole(user, ["admin", "coach"]); const previous = payload.id ? (await db.collection("classes").doc(payload.id).get()).data : null;
  if (user.role === "coach" && previous && previous.headCoachUserId !== user._id && !(user.classIds || []).includes(previous._id)) throw new Error("无权编辑该班级");
  const headCoachUserId = user.role === "coach" ? user._id : String(payload.headCoachUserId || "");
  if (user.role === "admin" && !headCoachUserId) throw new Error("请先在教练管理创建教练档案，再选择主教练");
  const headCoach = headCoachUserId ? (await db.collection("users").doc(headCoachUserId).get().catch(() => ({ data: null }))).data : null;
  const headCoachProfile = headCoachUserId ? (await db.collection("coachProfiles").where({ coachUserId: headCoachUserId }).limit(1).get()).data[0] : null;
  if (headCoachUserId && (!headCoachProfile || headCoachProfile.active === false) && (!headCoach || headCoach.role !== "coach" && !canSwitchTestRole(headCoach.openid))) throw new Error("主教练档案不存在或已停用");
  const headCoachName = (headCoachProfile || {}).name || (headCoach || {}).name || String(payload.headCoachName || "").trim();
  if (!headCoachName) throw new Error("请选择已建立的教练档案");
  const scheduleSlots = Array.isArray(payload.scheduleSlots) ? payload.scheduleSlots.map((slot) => ({ weekday: String(slot.weekday || ""), startTime: String(slot.startTime || ""), endTime: String(slot.endTime || "") })).filter((slot) => slot.weekday && slot.startTime && slot.endTime && slot.startTime < slot.endTime) : [];
  const schedule = scheduleSlots.length ? scheduleSlots.map((slot) => `${slot.weekday} ${slot.startTime}-${slot.endTime}`).join(" / ") : String(payload.schedule || "");
  const classCode = previous && previous.classCode || String(payload.classCode || "").trim().toUpperCase() || `NL${String(Math.floor(100000 + Math.random() * 900000))}`;
  const duplicateCode = await db.collection("classes").where({ classCode }).limit(10).get();
  if (duplicateCode.data.some((item) => item._id !== payload.id)) throw new Error("班级号已存在，请重新保存");
  const assistantCoachIds = user.role === "admin" ? [...new Set((payload.assistantCoachIds || []).filter((id) => id && id !== headCoachUserId))] : (previous || {}).assistantCoachIds || [];
  const assistantUsers = await fetchByIds("users", assistantCoachIds);
  const assistantProfiles = (await fetchAll("coachProfiles")).filter((item) => assistantCoachIds.includes(item.coachUserId) && item.active !== false);
  const assistantById = new Map([...assistantProfiles.map((item) => [item.coachUserId, item]), ...assistantUsers.map((item) => [item.coachId || item._id, item])]);
  if (assistantCoachIds.some((id) => !assistantById.has(id))) throw new Error("助理教练档案无效或已停用");
  const data = { classCode, name: String(payload.name || "").trim(), classType: payload.classType === "ELITE" ? "ELITE" : "REGULAR", ageGroup: String(payload.ageGroup || payload.group || ""), group: String(payload.ageGroup || payload.group || ""), standardCapacity: Math.max(1, Number(payload.standardCapacity || 20)), headCoachUserId, coachUserId: headCoachUserId, headCoachName, coachName: headCoachName, assistantCoachIds, assistantCoachName: assistantCoachIds.map((id) => (assistantById.get(id) || {}).name).filter(Boolean).join("、"), schedule, scheduleSlots, venue: String(payload.venue || ""), status: payload.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", active: payload.status !== "INACTIVE", remark: String(payload.remark || ""), studentIds: previous ? previous.studentIds || [] : [], updatedAt: nowText() };
  if (!data.name || !data.ageGroup || !data.headCoachName || !data.schedule || !data.venue) throw new Error("班级信息不完整"); let id = payload.id;
  if (id) await db.collection("classes").doc(id).update({ data }); else { const added = await db.collection("classes").add({ data: { ...data, createdAt: nowText() } }); id = added._id; }
  if (headCoach) { const nextClassIds = [...new Set([...(headCoach.classIds || []), id])]; await db.collection("users").doc(headCoachUserId).update({ data: { classIds: nextClassIds, updatedAt: nowText() } }); }
  for (const assistant of assistantUsers) await db.collection("users").doc(assistant._id).update({ data: { classIds: [...new Set([...(assistant.classIds || []), id])], updatedAt: nowText() } });
  for (const removedId of ((previous || {}).assistantCoachIds || []).filter((coachId) => !assistantCoachIds.includes(coachId))) { const removed = (await db.collection("users").doc(removedId).get().catch(() => ({ data: null }))).data; if (removed) await db.collection("users").doc(removedId).update({ data: { classIds: (removed.classIds || []).filter((classId) => classId !== id), updatedAt: nowText() } }); }
  const previousCoachUserId = previous && (previous.headCoachUserId || previous.coachUserId);
  if (previousCoachUserId && previousCoachUserId !== headCoachUserId) {
    const previousCoach = (await db.collection("users").doc(previousCoachUserId).get().catch(() => ({ data: null }))).data;
    if (previousCoach) await db.collection("users").doc(previousCoachUserId).update({ data: { classIds: (previousCoach.classIds || []).filter((classId) => classId !== id), updatedAt: nowText() } });
  }
  await audit(user, previous ? "updateClass" : "createClass", "class", id, { operator: user._id, classId: id, fromType: previous ? previous.classType || "REGULAR" : "", toType: data.classType, reason: previous && previous.classType !== data.classType ? "班级类型调整" : data.name }); return { id };
}

async function sessionAccess(user, session) { if (user.role === "coach" && !coachWorkService.effective(session).some((item) => item.coachId === user._id)) throw new Error("无权管理该课程"); }
async function decorateSession(session, studentId, internal = true) {
  const [members, trialCount, leaveRows, classResult, attendanceRows] = await Promise.all([
    classService.activeMembers(session.classId),
    crmService.trialCount(session._id),
    studentId ? db.collection("leaveRequests").where({ sessionId: session._id, studentId }).limit(100).get() : Promise.resolve({ data: [] }),
    db.collection("classes").doc(session.classId).get().catch(() => ({ data: null })),
    db.collection("attendance").where({ sessionId: session._id }).limit(100).get()
  ]);
  const leave = [...leaveRows.data].sort((a, b) => String(b.submittedAt || b.createdAt).localeCompare(String(a.submittedAt || a.createdAt)))[0];
  const memberIds = new Set(members.map((item) => item.studentId)); const expected = members.length;
  const attendanceStats = { expected, present: 0, leave: 0, injured: 0, absent: 0, unmarked: expected };
  attendanceRows.data.filter((record) => memberIds.has(record.studentId)).forEach((record) => { const key = record.status === "sick" ? "injured" : record.status; if (key in attendanceStats && key !== "expected" && key !== "unmarked") { attendanceStats[key] += 1; attendanceStats.unmarked = Math.max(0, attendanceStats.unmarked - 1); } });
  const leaveStatus = leave && leave.status === "pending" ? "leave_pending" : leave && leave.status === "approved" ? "leave_approved" : leave && leave.status === "rejected" ? "leave_rejected" : "";
  const clubClass = classResult.data || {}; const standardCapacity = Number(clubClass.standardCapacity || session.capacity || 20); const totalCount = expected + trialCount; const sessionView = publicDoc(session); delete sessionView.checkinCode; const workView = await coachWorkService.sessionView(session, "", internal); delete workView.checkinCode;
  const effectiveAssignments = coachWorkService.effective(session), primaryAssignment = effectiveAssignments.find((item) => item.role === "HEAD") || effectiveAssignments[0] || {};
  if (!internal) { delete sessionView.trainingNote; delete sessionView.weeklyTrainingPlanId; delete sessionView.trainingThemeKey; delete sessionView.updatedBy; }
  return { ...sessionView, ...workView, coach: await coachService.getReference(primaryAssignment.coachId || session.coachUserId || clubClass.headCoachUserId || clubClass.coachUserId, primaryAssignment.coachId ? "" : session.coachName || clubClass.headCoachName), className: clubClass.name || session.title || "", ageGroup: clubClass.ageGroup || "", standardCapacity, classType: clubClass.classType || "REGULAR", classTypeLabel: clubClass.classType === "ELITE" ? "精英队" : "普通班", memberCount: expected, enrolledCount: expected, trialCount, totalCount, overCapacity: Math.max(0, expected - standardCapacity), isFull: totalCount >= Number(session.capacity || standardCapacity), attendanceStats, checkinOpen: session.checkinStatus === "OPEN" && Number(session.checkinExpiresAt || 0) > Date.now(), myStatus: leaveStatus || (memberIds.has(studentId) ? "booked" : "none"), leaveRequestId: leave ? leave._id : "" };
}
async function listSessions(user, input) {
  let sessions = await fetchAll("sessions"); if (user.role === "parent") sessions = sessions.filter((item) => ["published", "COMPLETED", "CANCELLED"].includes(item.status)); if (user.role === "coach") sessions = sessions.filter((item) => coachWorkService.effective(item).some((row) => row.coachId === user._id));
  const studentId = input.studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : "");
  if (user.role === "parent") {
    if (!studentId) return [];
    await assertStudentAccess(user, studentId);
    const classIds = new Set((await classService.studentMemberships(studentId)).map((item) => item.classId));
    sessions = sessions.filter((item) => classIds.has(item.classId));
  }
  const rows = []; for (const session of sessions.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))) rows.push(await decorateSession(session, studentId, user.role !== "parent")); return rows;
}
async function getSession(user, id, studentId) {
  const session = (await db.collection("sessions").doc(validId(id)).get()).data; if (!session) throw new Error("课程不存在"); if (user.role === "parent" && !["published", "COMPLETED", "CANCELLED"].includes(session.status)) throw new Error("课程尚未发布"); await sessionAccess(user, session);
  const selectedStudentId = studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : "");
  if (user.role === "parent") { await assertStudentAccess(user, selectedStudentId); const membership = await db.collection("classMembers").where({ classId: session.classId, studentId: selectedStudentId, status: "ACTIVE" }).limit(1).get(); if (!membership.data.length) throw new Error("该学员不是本课程班级成员"); }
  const decorated = await decorateSession(session, selectedStudentId, user.role !== "parent"); if (user.role === "parent") return decorated;
  const [members, attendance] = await Promise.all([classService.activeMembers(session.classId), db.collection("attendance").where({ sessionId: id }).limit(100).get()]);
  const students = await fetchByIds("students", members.map((item) => item.studentId));
  return { ...decorated, enrollments: members.map((item) => ({ id: `${id}-${item.studentId}`, sessionId: id, studentId: item.studentId, attendanceStatus: (attendance.data.find((record) => record.studentId === item.studentId) || {}).status || "unmarked", student: publicDoc(students.find((s) => s._id === item.studentId)) })), trialStudents: await crmService.trialStudents(id) };
}
async function saveSession(user, payload) {
  if (payload.id) { const historical = (await db.collection("sessions").doc(payload.id).get().catch(() => ({ data: null }))).data; if (historical && historical.status === "COMPLETED") throw new Error("已完成课程只能通过课时更正流程修改教练"); }
  requireRole(user, ["admin"]); const previous = payload.id ? (await db.collection("sessions").doc(payload.id).get()).data : null; const base = { id: payload.id, classId: validId(payload.classId), title: String(payload.title || "").trim(), date: String(payload.date || ""), weekday: String(payload.weekday || ""), time: String(payload.time || ""), venue: String(payload.venue || ""), venueId: String(payload.venueId || ""), trainingTheme: String(payload.trainingTheme || ""), trainingThemeKey: String(payload.trainingThemeKey || ""), trainingFocus: String(payload.trainingFocus || payload.focus || ""), trainingNote: String(payload.trainingNote || ""), weeklyTrainingPlanId: String(payload.weeklyTrainingPlanId || ""), focus: String(payload.focus || payload.trainingFocus || ""), capacity: Math.max(1, Number(payload.capacity || 20)), enrollmentMode: payload.enrollmentMode || "open", status: payload.status || "published", publishStatus: payload.publishStatus || "PUBLISHED", plannedCoachAssignments: payload.plannedCoachAssignments, forceConflict: payload.forceConflict, conflictReason: payload.conflictReason, updatedAt: nowText() }; const prepared = await coachWorkService.prepareSession(user, base, previous); if (prepared.confirmationRequired) return prepared; const data = prepared.session; delete data.id; delete data._id; delete data.forceConflict; delete data.conflictReason;
  if (!data.title || !data.date || !data.time || !data.venue) throw new Error("课程信息不完整"); let id = payload.id;
  if (id) await db.collection("sessions").doc(id).update({ data }); else { const added = await db.collection("sessions").add({ data: { ...data, createdAt: nowText() } }); id = added._id; }
  await audit(user, "saveSession", "session", id, data.title); return { id };
}
async function enrollSession(user, input) {
  requireRole(user, ["admin", "parent"]); const studentId = validId(input.studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : "")); await assertStudentAccess(user, studentId);
  const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; if (!session || session.status !== "published") throw new Error("课程暂不可报名"); const student = (await db.collection("students").doc(studentId).get()).data; if (Number(student.remainingLessons || 0) <= 0) throw new Error("剩余课时不足，请先购买课程");
  const existing = (await db.collection("classMembers").where({ classId: session.classId, studentId, status: "ACTIVE" }).limit(1).get()).data[0]; if (existing) return { status: "booked", message: "已经是本班正式成员" };
  const joined = await classService.call(user.role === "admin" ? "addClassMember" : "joinClass", { classId: session.classId, studentId, source: user.role === "admin" ? "ADMIN_ADD" : "PARENT_SIGNUP", confirmCapacity: user.role === "admin" && Boolean(input.confirmCapacity) }, user);
  return { ...joined, status: joined.status === "FULL" ? "full" : "booked", message: joined.message || "报名成功" };
}
async function requestLeave(user, input) {
  requireRole(user, ["admin", "parent"]); const studentId = validId(input.studentId || (user.role === "parent" ? await firstOwnedStudentId(user) : "")); await assertStudentAccess(user, studentId);
  const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; const membership = session ? await db.collection("classMembers").where({ classId: session.classId, studentId, status: "ACTIVE" }).limit(1).get() : { data: [] }; if (!session || !membership.data.length) throw new Error("该学员不是本班正式成员"); const [duplicate, approved] = await Promise.all([db.collection("leaveRequests").where({ sessionId: input.sessionId, studentId, status: "pending" }).limit(1).get(), db.collection("leaveRequests").where({ sessionId: input.sessionId, studentId, status: "approved" }).limit(1).get()]); if (duplicate.data.length) throw new Error("请假申请已提交"); if (approved.data.length) throw new Error("该课程请假已经批准");
  const submittedAt = nowText(); const added = await db.collection("leaveRequests").add({ data: { sessionId: input.sessionId, classId: session.classId, studentId, reason: String(input.reason || "学员请假"), status: "pending", submittedAt, createdAt: submittedAt, creatorId: user._id } }); const clubClass = (await db.collection("classes").doc(session.classId).get()).data; await businessService.notify((clubClass || {}).headCoachUserId || (clubClass || {}).coachUserId, "LEAVE_REQUEST", "新的请假申请", `${session.title}收到一条请假申请`, { leaveRequestId: added._id, sessionId: input.sessionId, studentId }); await audit(user, "requestLeave", "leave", added._id, { studentId, sessionId: input.sessionId, leaveRequestId: added._id, operator: user._id, oldStatus: "NONE", newStatus: "pending", lessonDelta: 0 }); return { id: added._id, status: "pending" };
}
async function cancelLeave(user, input) {
  requireRole(user, ["admin", "parent"]); const requestId = validId(input.id); const request = (await db.collection("leaveRequests").doc(requestId).get()).data; if (!request) throw new Error("请假申请不存在"); await assertStudentAccess(user, request.studentId);
  const result = await db.runTransaction(async (transaction) => { const current = (await transaction.collection("leaveRequests").doc(requestId).get()).data; if (current.status === "cancelled") return { status: "cancelled", idempotent: true }; if (current.status === "approved") throw new Error("已批准请假请联系俱乐部管理员处理"); if (current.status !== "pending") throw new Error("当前请假状态不可撤销"); await transaction.collection("leaveRequests").doc(requestId).update({ data: { status: "cancelled", cancelledAt: nowText(), cancelledBy: user._id } }); return { status: "cancelled", idempotent: false }; });
  if (!result.idempotent) await audit(user, "cancelLeave", "leave", requestId, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: requestId, operator: user._id, oldStatus: "pending", newStatus: "cancelled", lessonDelta: 0 }); return { ok: true, ...result };
}
async function listLeaveRequests(user, input = {}) {
  let rows = await fetchAll("leaveRequests"); if (user.role === "parent") { if (input.studentId) await assertStudentAccess(user, input.studentId); const owned = new Set(await allowedStudentIds(user)); rows = rows.filter((item) => owned.has(item.studentId) && (!input.studentId || item.studentId === input.studentId)); } if (user.role === "coach") { const sessions = await fetchByIds("sessions", rows.map((item) => item.sessionId)); const allowed = new Set(sessions.filter((item) => (user.classIds || []).includes(item.classId)).map((item) => item._id)); rows = rows.filter((item) => allowed.has(item.sessionId)); }
  const [students, sessions] = await Promise.all([fetchByIds("students", rows.map((item) => item.studentId)), fetchByIds("sessions", rows.map((item) => item.sessionId))]); const classes = await fetchByIds("classes", sessions.map((item) => item.classId)); return rows.sort((a, b) => String(b.submittedAt || b.createdAt).localeCompare(String(a.submittedAt || a.createdAt))).map((item) => { const session = sessions.find((s) => s._id === item.sessionId); return { ...publicDoc(item), submittedAt: item.submittedAt || item.createdAt, student: publicDoc(students.find((s) => s._id === item.studentId)), session: publicDoc(session), clubClass: publicDoc(classes.find((clubClass) => clubClass._id === (item.classId || (session || {}).classId))) }; });
}
async function attendanceChangeInTransaction(transaction, user, session, studentId, status, context = {}) {
  if (!(status in DEDUCTION)) throw new Error("无效出勤状态");
  const existing = (await transaction.collection("attendance").where({ sessionId: session._id, studentId }).limit(1).get()).data[0]; const oldStatus = existing ? existing.status : "unmarked"; const previous = existing ? Number(existing.deductedLessons || 0) : 0; const next = DEDUCTION[status]; const updatedAt = nowText();
  const lessonDelta = previous - next;
  let entitlementId = existing && existing.entitlementId || "";
  if (lessonDelta) { const lessonResult = await businessService.applyLessonDeltaInTransaction(transaction, user, session, studentId, lessonDelta, { ...context, entitlementId, note: context.note || `${session.title} ${status}` }); entitlementId = lessonResult.entitlementId || entitlementId; }
  if (existing) await transaction.collection("attendance").doc(existing._id).update({ data: { status, deductedLessons: next, entitlementId, source: context.source || existing.source || "ATTENDANCE", leaveRequestId: context.leaveRequestId || existing.leaveRequestId || "", updatedAt, operatorId: user._id } });
  else await transaction.collection("attendance").add({ data: { sessionId: session._id, classId: session.classId, studentId, date: session.date, status, deductedLessons: next, entitlementId, source: context.source || "ATTENDANCE", leaveRequestId: context.leaveRequestId || "", createdAt: updatedAt, updatedAt, operatorId: user._id } });
  return { oldStatus, newStatus: status, lessonDelta, entitlementId };
}
async function reviewLeave(user, input) {
  requireRole(user, ["admin", "coach"]); const requestId = validId(input.id); const request = (await db.collection("leaveRequests").doc(requestId).get()).data; if (!request) throw new Error("请假申请不存在"); const session = (await db.collection("sessions").doc(request.sessionId).get()).data; if (!session) throw new Error("课程不存在"); await sessionAccess(user, session); const status = input.approved ? "approved" : "rejected";
  const result = await db.runTransaction(async (transaction) => { const current = (await transaction.collection("leaveRequests").doc(requestId).get()).data; if (current.status === status) return { status, idempotent: true, correction: { oldStatus: status === "approved" ? "leave" : "unmarked", newStatus: status === "approved" ? "leave" : "unmarked", lessonDelta: 0 } }; if (current.status !== "pending") throw new Error("申请状态已变化"); let correction = { oldStatus: "unmarked", newStatus: "unmarked", lessonDelta: 0 }; if (input.approved) correction = await attendanceChangeInTransaction(transaction, user, session, current.studentId, "leave", { source: "LEAVE_APPROVAL", leaveRequestId: requestId, ledgerType: "leave_correction", note: `${session.title}请假审批课时返还` }); await transaction.collection("leaveRequests").doc(requestId).update({ data: { status, reviewedAt: nowText(), reviewerId: user._id, reviewNote: String(input.note || "") } }); return { status, idempotent: false, correction }; });
  if (!result.idempotent) { await audit(user, input.approved ? "approveLeave" : "rejectLeave", "leave", requestId, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: requestId, operator: user._id, oldStatus: "pending", newStatus: status, attendanceOldStatus: result.correction.oldStatus, attendanceNewStatus: result.correction.newStatus, lessonDelta: result.correction.lessonDelta }); if (result.correction.lessonDelta) await audit(user, "leaveLessonCorrection", "student", request.studentId, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: requestId, operator: user._id, oldStatus: result.correction.oldStatus, newStatus: "leave", lessonDelta: result.correction.lessonDelta }); }
  const student = (await db.collection("students").doc(request.studentId).get()).data; await businessService.notify((student || {}).ownerParentUserId || request.creatorId, "LEAVE_RESULT", input.approved ? "请假已批准" : "请假未批准", `${session.title}：${input.approved ? "请假已批准" : "请假未批准"}`, { leaveRequestId: requestId, sessionId: request.sessionId, studentId: request.studentId });
  return { ok: true, status, idempotent: result.idempotent, lessonDelta: result.correction.lessonDelta };
}

async function getAttendanceSheet(user, input) {
  requireRole(user, ["admin", "coach"]); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; await sessionAccess(user, session);
  const [members, records, approvedLeaves, trialStudents] = await Promise.all([classService.activeMembers(session.classId), db.collection("attendance").where({ sessionId: input.sessionId }).limit(100).get(), db.collection("leaveRequests").where({ sessionId: input.sessionId, status: "approved" }).limit(100).get(), crmService.trialStudents(input.sessionId)]); const students = await fetchByIds("students", members.map((item) => item.studentId));
  return { session: publicDoc(session), date: session.date, students: students.map((student) => { const record = records.data.find((item) => item.studentId === student._id); const approvedLeave = approvedLeaves.data.find((item) => item.studentId === student._id); const attendanceStatus = record ? record.status : "unmarked"; return { ...publicDoc(student), initial: student.name ? student.name[0] : "学", attendanceStatus, leaveApproved: Boolean(approvedLeave), leaveRequestId: approvedLeave ? approvedLeave._id : "", leaveLocked: Boolean(approvedLeave && attendanceStatus === "leave"), leaveOverride: Boolean(approvedLeave && attendanceStatus !== "leave") }; }), trialStudents };
}
async function submitAttendance(user, input) {
  requireRole(user, ["admin", "coach"]); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; await sessionAccess(user, session); if (session.status === "CANCELLED") throw new Error("已取消课程不能点名或消课"); const members = await classService.activeMembers(session.classId); const allowed = new Set(members.map((item) => item.studentId));
  const overrides = [];
  for (const record of input.records || []) {
    if (!allowed.has(record.studentId)) throw new Error("点名名单包含非本班正式成员"); if (!(record.status in DEDUCTION)) throw new Error("无效出勤状态");
    const change = await db.runTransaction(async (transaction) => { const approvedLeave = (await transaction.collection("leaveRequests").where({ sessionId: input.sessionId, studentId: record.studentId, status: "approved" }).limit(1).get()).data[0]; if (approvedLeave && record.status !== "leave" && !record.overrideApprovedLeave) throw new Error("已批准请假，修改状态前需要确认"); const correction = await attendanceChangeInTransaction(transaction, user, session, record.studentId, record.status, { source: approvedLeave ? (record.status === "leave" ? "LEAVE_APPROVAL" : "LEAVE_ADMIN_OVERRIDE") : "ATTENDANCE", leaveRequestId: approvedLeave ? approvedLeave._id : "" }); return { approvedLeaveId: approvedLeave ? approvedLeave._id : "", correction }; });
    if (change.approvedLeaveId && record.status !== "leave") overrides.push({ studentId: record.studentId, leaveRequestId: change.approvedLeaveId, ...change.correction });
  }
  for (const change of overrides) await audit(user, "overrideApprovedLeaveAttendance", "attendance", change.studentId, { studentId: change.studentId, sessionId: input.sessionId, leaveRequestId: change.leaveRequestId, operator: user._id, oldStatus: change.oldStatus, newStatus: change.newStatus, lessonDelta: change.lessonDelta });
  await crmService.applyTrialAttendance(user, input.sessionId, input.trialRecords || []);
  for (const record of input.records || []) if (record.status === "absent") { const student = (await db.collection("students").doc(record.studentId).get()).data; await businessService.notify((student || {}).ownerParentUserId, "ABSENCE", "缺课通知", `${session.title}已记录为缺勤`, { sessionId: input.sessionId, studentId: record.studentId }); }
  await audit(user, "submitAttendance", "session", input.sessionId, `${(input.records || []).length}人`); return { ok: true };
}
function locationDistance(lat1, lng1, lat2, lng2) {
  const rad = (value) => Number(value) * Math.PI / 180; const earth = 6371000; const dLat = rad(lat2) - rad(lat1); const dLng = rad(lng2) - rad(lng1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2; return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function openCheckin(user, input) {
  requireRole(user, ["admin", "coach"]); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; if (!session) throw new Error("课程不存在"); await sessionAccess(user, session);
  const latitude = Number(input.latitude); const longitude = Number(input.longitude); if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("需要获取教练当前位置作为签到中心");
  const checkinCode = String(Math.floor(100000 + Math.random() * 900000)); const checkinExpiresAt = Date.now() + Math.max(5, Math.min(120, Number(input.minutes || 30))) * 60 * 1000; const checkinRadius = Math.max(50, Math.min(2000, Number(input.radius || 300))); const updatedAt = nowText();
  await db.collection("sessions").doc(session._id).update({ data: { checkinStatus: "OPEN", checkinCode, checkinExpiresAt, checkinLatitude: latitude, checkinLongitude: longitude, checkinRadius, checkinOpenedBy: user._id, checkinOpenedAt: updatedAt, updatedAt } }); await audit(user, "OPEN_CHECKIN", "session", session._id, { checkinRadius, checkinExpiresAt }); return { code: checkinCode, expiresAt: checkinExpiresAt, radius: checkinRadius };
}
async function getCheckinInfo(user, input) {
  requireRole(user, ["admin", "coach"]); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; if (!session) throw new Error("课程不存在"); await sessionAccess(user, session); return { status: session.checkinStatus || "CLOSED", code: session.checkinCode || "", expiresAt: Number(session.checkinExpiresAt || 0), radius: Number(session.checkinRadius || 0), open: session.checkinStatus === "OPEN" && Number(session.checkinExpiresAt || 0) > Date.now() };
}
async function closeCheckin(user, input) {
  requireRole(user, ["admin", "coach"]); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; if (!session) throw new Error("课程不存在"); await sessionAccess(user, session); await db.collection("sessions").doc(session._id).update({ data: { checkinStatus: "CLOSED", checkinCode: "", checkinClosedAt: nowText(), updatedAt: nowText() } }); await audit(user, "CLOSE_CHECKIN", "session", session._id, {}); return { ok: true };
}
async function selfCheckin(user, input) {
  requireRole(user, ["parent"]); const studentId = validId(input.studentId || await firstOwnedStudentId(user)); await assertStudentAccess(user, studentId); const session = (await db.collection("sessions").doc(validId(input.sessionId)).get()).data; if (!session || session.status !== "published") throw new Error("课程不可签到"); if (session.checkinStatus !== "OPEN" || Number(session.checkinExpiresAt || 0) <= Date.now()) throw new Error("签到已结束"); if (String(input.code || "").trim() !== String(session.checkinCode || "")) throw new Error("签到校验码错误");
  const member = await db.collection("classMembers").where({ classId: session.classId, studentId, status: "ACTIVE" }).limit(1).get(); if (!member.data.length) throw new Error("该学员不是本班成员"); const latitude = Number(input.latitude); const longitude = Number(input.longitude); if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("无法获取签到位置"); const distance = locationDistance(latitude, longitude, session.checkinLatitude, session.checkinLongitude); if (distance > Number(session.checkinRadius || 300)) throw new Error(`距离签到地点约${Math.round(distance)}米，超出范围`);
  const result = await db.runTransaction((transaction) => attendanceChangeInTransaction(transaction, user, session, studentId, "present", { source: "SELF_CHECKIN", note: `${session.title}定位签到` })); await audit(user, "SELF_CHECKIN", "session", session._id, { studentId, distance: Math.round(distance), lessonDelta: result.lessonDelta }); return { ok: true, distance: Math.round(distance), attendanceStatus: "present" };
}
async function getLessonLedger(user, studentId) { await assertStudentAccess(user, studentId); return (await db.collection("lessonLedger").where({ studentId }).orderBy("createdAt", "desc").limit(100).get()).data.map(publicDoc); }
async function createInvite(user, input) { requireRole(user, ["admin"]); if (input.role === "coach") throw new Error("教练账号必须从教练管理生成档案专属绑定邀请"); if (!["admin", "parent"].includes(input.role)) throw new Error("邀请角色无效"); if (input.role === "parent") { const student = (await db.collection("students").doc(validId(input.studentId)).get()).data; if (!student) throw new Error("学员不存在"); if (student.ownerParentUserId) throw new Error("该学员已有学员端账号归属；如需更换，请使用归属转移。"); } const code = String(Math.floor(100000 + Math.random() * 900000)); const expiresAt = Date.now() + 24 * 60 * 60 * 1000; await db.collection("invites").add({ data: { code, role: input.role, studentId: input.studentId || "", classId: "", displayName: String(input.displayName || ""), status: "active", expiresAt, createdAt: nowText(), creatorId: user._id } }); await audit(user, "CREATE_ROLE_INVITE", "invite", code, { role: input.role, classId: "" }); return { code, expiresAt }; }
async function claimStaffInvite(openid, code) {
  const found = await db.collection("invites").where({ code: String(code || "").trim(), status: "active" }).limit(1).get();
  const invite = found.data[0];
  if (!invite || Number(invite.expiresAt || 0) < Date.now() || invite.role !== "admin") throw new Error("管理员授权码无效或已过期；教练请使用教练专属绑定入口");
  const existing = await findUser(openid);
  const canUpgradePlaceholder = isLegacyPlaceholder(existing) && !(await db.collection("students").where({ ownerParentUserId: existing._id, status: "active" }).limit(1).get()).data.length;
  if (existing && !canUpgradePlaceholder && existing.role !== invite.role) throw new Error("当前微信已绑定其他身份，不能切换主角色，请联系管理员处理");
  const now = nowText();
  let userId = existing && existing._id || userDocumentId(openid);
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection("invites").doc(invite._id).get()).data;
    if (!current || current.status !== "active" || Number(current.expiresAt || 0) < Date.now()) throw new Error("工作人员授权码已经使用或过期");
    const userData = { openid, role: current.role, name: current.displayName || (existing || {}).name || (current.role === "coach" ? "南联教练" : "南联管理员"), status: "ACTIVE", active: true, studentIds: [], classIds: current.role === "coach" ? [...new Set([...(existing || {}).classIds || [], current.classId].filter(Boolean))] : (existing || {}).classIds || [], profileCompleted: true, authorizationSource: "ADMIN_STAFF_INVITE", updatedAt: now };
    if (existing) await transaction.collection("users").doc(existing._id).update({ data: userData });
    else await transaction.collection("users").doc(userId).set({ data: { ...userData, createdAt: now } });
    if (current.role === "coach") {
      const clubClass = (await transaction.collection("classes").doc(current.classId).get()).data;
      if (!clubClass) throw new Error("授权码绑定的班级不存在");
      await transaction.collection("classes").doc(current.classId).update({ data: { headCoachUserId: userId, coachUserId: userId, headCoachName: userData.name, coachName: userData.name, updatedAt: now } });
    }
    await transaction.collection("invites").doc(invite._id).update({ data: { status: "used", usedBy: userId, usedAt: now } });
  });
  const user = await db.collection("users").doc(userId).get();
  await audit(user.data, "CLAIM_STAFF_INVITE", "user", userId, { inviteId: invite._id, role: invite.role });
  return { authorized: true, accountState: ACCOUNT_STATES.ACTIVE, user: publicAuthUser(user.data) };
}
async function claimInvite(user, code) {
  const found = await db.collection("invites").where({ code: String(code || "").trim(), status: "active" }).limit(1).get(); const invite = found.data[0]; if (!invite || Number(invite.expiresAt || 0) < Date.now()) throw new Error("邀请码无效或已过期");
  if (invite.role === "coach") throw new Error("旧教练邀请码已停用，请联系管理员生成教练档案专属绑定邀请");
  if (invite.role !== user.role) throw new Error("当前账号不能切换主身份；工作人员请从登录页使用管理员授权码");
  if (invite.role === "parent") { const activeLinks = await db.collection("parentStudentLinks").where({ studentId: invite.studentId, status: "ACTIVE" }).limit(100).get(); if (activeLinks.data.some((item) => item.parentUserId !== user._id)) throw new Error("该学员存在历史家长归属冲突，需要管理员人工确认"); }
  await db.runTransaction(async (transaction) => { const current = (await transaction.collection("invites").doc(invite._id).get()).data; if (current.status !== "active" || Number(current.expiresAt || 0) < Date.now()) throw new Error("邀请码已经使用"); const update = { role: current.role, name: current.displayName || user.name, updatedAt: nowText() }; if (current.role === "parent") { const student = (await transaction.collection("students").doc(current.studentId).get()).data; if (!student) throw new Error("学员不存在"); if (student.ownerParentUserId && student.ownerParentUserId !== user._id) throw new Error("该学员已经绑定学员端账号，请联系俱乐部管理员处理。"); await transaction.collection("students").doc(student._id).update({ data: { ownerParentUserId: user._id, updatedAt: nowText() } }); } if (current.role === "coach") { update.classIds = [...new Set([...(user.classIds || []), current.classId].filter(Boolean))]; const clubClass = (await transaction.collection("classes").doc(current.classId).get()).data; if (!clubClass) throw new Error("邀请码绑定的班级不存在"); await transaction.collection("classes").doc(current.classId).update({ data: { headCoachUserId: user._id, coachUserId: user._id, headCoachName: update.name, coachName: update.name, updatedAt: nowText() } }); } await transaction.collection("users").doc(user._id).update({ data: update }); await transaction.collection("invites").doc(invite._id).update({ data: { status: "used", usedBy: user._id, usedAt: nowText() } }); }); if (invite.role === "parent") { const ids = (await fetchAll("students", { ownerParentUserId: user._id, status: "active" })).map((item) => item._id); await db.collection("users").doc(user._id).update({ data: { studentIds: ids, updatedAt: nowText() } }); const active = await db.collection("parentStudentLinks").where({ studentId: invite.studentId, status: "ACTIVE" }).limit(100).get(); if (active.data.some((item) => item.parentUserId !== user._id)) throw new Error("该学员存在历史学员端账号归属冲突，需要管理员人工确认"); if (!active.data.some((item) => item.parentUserId === user._id)) await db.collection("parentStudentLinks").add({ data: { parentUserId: user._id, studentId: invite.studentId, relationship: "GUARDIAN", isPrimaryGuardian: true, status: "ACTIVE", createdAt: nowText(), updatedAt: nowText(), source: "PARENT_INVITE" } }); await audit(user, "CLAIM_STUDENT_PARENT_INVITE", "student", invite.studentId, { parentUserId: user._id, inviteId: invite._id }); } return { ok: true, role: invite.role };
}

async function getDashboard(user, input = {}) {
  let students = await listStudents(user); if (user.role === "parent" && input.activeStudentId) { await assertStudentAccess(user, input.activeStudentId); students = students.filter((item) => item.id === input.activeStudentId); } const selectedId = user.role === "parent" ? (students[0] || {}).id : ""; const [classes, sessions, leaves] = await Promise.all([listClasses(user), listSessions(user, { studentId: selectedId }), listLeaveRequests(user, { studentId: selectedId })]); const studentIds = students.map((item) => item.id); let todayAttendance = 0;
  if (studentIds.length) { const batches = []; for (let i = 0; i < studentIds.length; i += 100) batches.push(db.collection("attendance").where({ date: todayText(), studentId: command.in(studentIds.slice(i, i + 100)) }).count()); todayAttendance = (await Promise.all(batches)).reduce((sum, item) => sum + item.total, 0); }
  return { role: user.role, studentCount: students.length, classCount: classes.length, lowBalance: students.filter((item) => Number(item.remainingLessons) <= 5).length, todayAttendance, pendingLeaves: leaves.filter((item) => item.status === "pending").length, recentStudents: [...students].sort((a, b) => Number(a.remainingLessons) - Number(b.remainingLessons)).slice(0, 3), classes, sessions: sessions.slice(0, 4) };
}
async function getOperationsDashboard(user) {
  requireRole(user, ["admin", "coach"]); const [dashboard, leaves, logs, commerce] = await Promise.all([getDashboard(user), listLeaveRequests(user), db.collection("auditLogs").orderBy("createdAt", "desc").limit(30).get(), businessService.metrics()]); return { role: user.role, metrics: { students: dashboard.studentCount, sessions: dashboard.sessions.length, classMembers: dashboard.classes.reduce((sum, item) => sum + item.studentCount, 0), pendingLeaves: leaves.filter((item) => item.status === "pending").length, paidOrders: commerce.paidOrders, pendingOrders: commerce.pendingOrders, revenueYuan: (commerce.revenueCents / 100).toFixed(2), attendanceRate: commerce.attendanceRate }, alerts: dashboard.lowBalance ? [{ level: "danger", text: `${dashboard.lowBalance}名学员课时不足5节` }] : [], sessions: dashboard.sessions, auditLogs: logs.data.map(publicDoc) };
}

exports.main = async (event) => {
  try {
    if (paymentService.isHttpNotifyEvent(event)) return paymentService.handleNotify(event);
    await ensureCollections(); await classService.ensureMigration(); await businessService.ensureDefaults(); await coachService.ensureDefaults(); await coachWorkService.ensureMigration(); await trainingService.ensureDefaults(); await growthService.ensureDefaults(); await leagueService.ensureDefaults();
    const openid = cloud.getWXContext().OPENID;
    const input = event.data || {};
    const user = await resolveUser(openid);
    let data;
    if (event.action === "getAuthContext") {
      if (user && user.role === "coach" && accountState(user) === ACCOUNT_STATES.ACTIVE) await coachBindingService.assertCoachAccess(user, { allowTestRole: canSwitchTestRole(openid), touch: true });
      const state = accountState(user);
      data = { mode: "cloud", accountState: state, registered: state !== ACCOUNT_STATES.UNREGISTERED, active: state === ACCOUNT_STATES.ACTIVE, user: publicAuthUser(user) };
      return { success: true, data };
    }
    if (event.action === "registerParent") {
      data = await registerParent(openid, input);
      return { success: true, data };
    }
    if (event.action === "staffLogin") {
      const state = accountState(user);
      if (state === ACCOUNT_STATES.DISABLED) return { success: true, data: { authorized: false, accountState: state, message: "当前账号暂不可使用，如有疑问请联系南联俱乐部管理员。" } };
      if (state !== ACCOUNT_STATES.ACTIVE || !["coach", "admin"].includes(user.role)) return { success: true, data: { authorized: false, accountState: state, message: "暂未找到您的工作人员账号，请联系南联俱乐部管理员完成账号授权。" } };
      if (user.role === "coach") await coachBindingService.assertCoachAccess(user, { allowTestRole: canSwitchTestRole(openid), touch: true });
      return { success: true, data: { authorized: true, accountState: state, user: publicAuthUser(user) } };
    }
    if (event.action === "claimStaffInvite") {
      data = await claimStaffInvite(openid, input.code);
      return { success: true, data };
    }
    if (coachBindingService.publicHandles(event.action)) {
      data = await coachBindingService.call(event.action, input, user, openid);
      return { success: true, data };
    }
    assertActiveUser(user);
    await coachBindingService.assertCoachAccess(user, { allowTestRole: canSwitchTestRole(openid) });
    await familyService.ensureMigration(user);
    if (classService.handles(event.action)) data = await classService.call(event.action, input, user);
    else if (familyService.handles(event.action)) data = await familyService.call(event.action, input, user);
    else if (businessService.handles(event.action)) data = await businessService.call(event.action, input, user);
    else if (paymentService.handles(event.action)) data = await paymentService.call(event.action, input, user, cloud.getWXContext().OPENID);
    else if (coachBindingService.handles(event.action)) data = await coachBindingService.call(event.action, input, user, openid);
    else if (coachService.handles(event.action)) data = await coachService.call(event.action, input, user);
    else if (coachWorkService.handles(event.action)) data = await coachWorkService.call(event.action, input, user);
    else if (timetableService.handles(event.action)) data = await timetableService.call(event.action, input, user);
    else if (crmService.handles(event.action)) data = await crmService.call(event.action, input, user);
    else if (trainingService.handles(event.action)) data = await trainingService.call(event.action, input, user);
    else if (growthService.handles(event.action)) data = await growthService.call(event.action, input, user);
    else if (leagueService.handles(event.action)) data = await leagueService.call(event.action, input, user);
    else switch (event.action) {
      case "getContext": { const owned = user.role === "parent" ? await allowedStudentIds(user) : []; data = { mode: "cloud", accountState: ACCOUNT_STATES.ACTIVE, user: publicAuthUser(user), needsProfile: user.role === "parent" && !owned.length, needsBinding: user.role === "coach" && !(user.classIds || []).length, canSwitchTestRole: canSwitchTestRole(openid) }; break; }
      case "switchTestRole": {
        if (!canSwitchTestRole(cloud.getWXContext().OPENID)) throw new Error("当前账号未获准切换测试角色");
        const role = String(input.role || "");
        if (!["admin", "coach", "parent"].includes(role)) throw new Error("测试角色无效");
        await db.collection("users").doc(user._id).update({ data: { role, updatedAt: nowText(), testRoleUpdatedAt: nowText() } });
        await audit(user, "SWITCH_TEST_ROLE", "user", user._id, { role });
        data = { role };
        break;
      }
      case "getDashboard": data = await getDashboard(user, input); break;
      case "getOperationsDashboard": data = await getOperationsDashboard(user); break;
      case "listStudents": data = await listStudents(user); break;
      case "getStudent": data = await getStudent(user, input.id); break;
      case "saveStudent": data = await saveStudent(user, input.student || {}); break;
      case "listClasses": data = await listClasses(user, input); break;
      case "listClassCoaches": data = await listClassCoaches(user); break;
      case "getClass": data = await getClass(user, input.id); break;
      case "saveClass": data = await saveClass(user, input.clubClass || {}); break;
      case "listSessions": data = await listSessions(user, input); break;
      case "getSession": data = await getSession(user, input.id, input.studentId); break;
      case "saveSession": data = await saveSession(user, input.session || {}); break;
      case "enrollSession": data = await enrollSession(user, input); break;
      case "requestLeave": data = await requestLeave(user, input); break;
      case "cancelLeave": data = await cancelLeave(user, input); break;
      case "listLeaveRequests": data = await listLeaveRequests(user, input); break;
      case "reviewLeave": data = await reviewLeave(user, input); break;
      case "getAttendanceSheet": data = await getAttendanceSheet(user, input); break;
      case "submitAttendance": data = await submitAttendance(user, input); break;
      case "openCheckin": data = await openCheckin(user, input); break;
      case "getCheckinInfo": data = await getCheckinInfo(user, input); break;
      case "closeCheckin": data = await closeCheckin(user, input); break;
      case "selfCheckin": data = await selfCheckin(user, input); break;
      case "getLessonLedger": data = await getLessonLedger(user, input.studentId); break;
      case "createInvite": data = await createInvite(user, input); break;
      case "claimInvite": data = await claimInvite(user, input.code); break;
      default: throw new Error("未知操作");
    }
    return { success: true, data };
  } catch (error) { console.error(error); return { success: false, code: error.code || "SERVICE_ERROR", message: error.message || "服务异常" }; }
};
