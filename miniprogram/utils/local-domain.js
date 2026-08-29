const { today } = require("./format");
const crm = require("./crm-domain");
const classesV3 = require("./class-domain");
const growth = require("./growth-domain");
const league = require("./league-domain");
const family = require("./family-domain");
const coachProfiles = require("./coach-profile-domain");
const coachWork = require("./coach-work-domain");
const timetable = require("./timetable-domain");
const training = require("./training-domain");

const STORAGE_KEY = "nanlianClubV2";
const PACKAGES = {
  p14: { name: "一周一练", lessons: 14, amount: 1380 },
  p28: { name: "一周两练", lessons: 28, amount: 1980 }
};
const COURSE_PACKAGE_DEFAULTS = [
  { id: "pkg14", packageCode: "NL14", name: "14节训练套餐", lessonCount: 14, priceFen: 138000, validityMonths: 5, status: "ACTIVE", sortOrder: 10 },
  { id: "pkg28", packageCode: "NL28", name: "28节训练套餐", lessonCount: 28, priceFen: 198000, validityMonths: 9, status: "ACTIVE", sortOrder: 20 },
  { id: "pkg40", packageCode: "NL40", name: "40节训练套餐", lessonCount: 40, priceFen: 248000, validityMonths: 12, status: "ACTIVE", sortOrder: 30 }
];
const DEDUCTION = { present: 1, absent: 1, leave: 0, sick: 0 };

function seed() {
  const demoStudents = Array.from({ length: 18 }, (_, index) => {
    const number = index + 5;
    return { id: `s${number}`, name: `U7演示学员${String(index + 1).padStart(2, "0")}`, gender: index % 3 === 0 ? "女" : "男", birthDate: `2017-${String(index % 12 + 1).padStart(2, "0")}-15`, guardianName: `家长${index + 1}`, guardianPhone: `1350000${String(index + 1).padStart(4, "0")}`, emergencyContact: `家长${index + 1} 1350000${String(index + 1).padStart(4, "0")}`, healthNotes: "无", remainingLessons: 14, totalLessons: 14, classIds: ["cu7base"], status: "active" };
  });
  const fullU7MemberIds = ["s1", "s2", ...demoStudents.map((item) => item.id)];
  return {
    students: [
      { id: "s1", name: "陈小南", avatarUrl: "/images/avatar.png", gender: "男", birthDate: "2017-03-18", guardianName: "陈女士", guardianPhone: "13800001203", emergencyContact: "陈先生 13900001203", healthNotes: "无", remainingLessons: 19, totalLessons: 28, classIds: ["cu7base", "c1718"], status: "active" },
      { id: "s2", name: "周子航", avatarUrl: "/images/avatar.png", gender: "男", birthDate: "2017-11-02", guardianName: "周先生", guardianPhone: "13600009081", emergencyContact: "周女士 13700009081", healthNotes: "左膝旧伤，训练前加强热身", remainingLessons: 4, totalLessons: 28, classIds: ["cu7base", "c1718"], status: "active" },
      { id: "s3", name: "林一诺", gender: "女", birthDate: "2016-07-09", guardianName: "林女士", guardianPhone: "13900006618", emergencyContact: "林先生 13800006618", healthNotes: "无", remainingLessons: 11, totalLessons: 14, classIds: ["cu8advanced", "c1516"], status: "active" },
      { id: "s4", name: "王奕辰", gender: "男", birthDate: "2019-09-23", guardianName: "王先生", guardianPhone: "13700004329", emergencyContact: "王女士 13600004329", healthNotes: "近期脚踝轻微不适", remainingLessons: 2, totalLessons: 14, classIds: ["cinterest"], status: "active" },
      { id: "s-growth", name: "王小明", avatarUrl: "/images/nanlian-logo.png", gender: "男", birthDate: "2017-05-12", guardianName: "王女士", guardianPhone: "13800008888", emergencyContact: "王先生 13900008888", healthNotes: "无", remainingLessons: 18, totalLessons: 28, classIds: ["cu8advanced", "c1516"], registrationDate: "2025-05-10", status: "active" }
      , ...demoStudents
    ],
    classes: [
      { id: "cinterest", name: "U6启蒙班", classType: "REGULAR", ageGroup: "U6 / 2019-2020", standardCapacity: 16, group: "启蒙班", headCoachName: "王蒋生", coachName: "王蒋生", assistantCoachName: "", coachUserId: "coach2", schedule: "周五 19:00-20:30", venue: "瓯北中心小学", status: "ACTIVE", remark: "兴趣启蒙与球感培养", studentIds: ["s4"], active: true },
      { id: "cu7base", name: "U7基础班", classType: "REGULAR", ageGroup: "U7 / 2017", standardCapacity: 20, group: "基础班", headCoachName: "王蒋生", coachName: "王蒋生", assistantCoachName: "张教练", coachUserId: "coach2", schedule: "周三 19:00-20:30", venue: "瓯北中心小学", status: "ACTIVE", remark: "演示满员普通班", studentIds: fullU7MemberIds, active: true },
      { id: "cu8advanced", name: "U8提高班", classType: "REGULAR", ageGroup: "U8 / 2016", standardCapacity: 20, group: "提高班", headCoachName: "游导", coachName: "游导", assistantCoachName: "王蒋生", coachUserId: "coach1", schedule: "周一/三 19:00-20:30", venue: "瓯北中心小学", status: "ACTIVE", remark: "技术提高与比赛衔接", studentIds: ["s3", "s-growth"], active: true },
      { id: "c1718", name: "U7精英队", classType: "ELITE", ageGroup: "U7 / 2017", standardCapacity: 18, group: "丙组梯队", headCoachName: "游导", coachName: "游导", assistantCoachName: "王蒋生", coachUserId: "coach1", schedule: "周二/四/六 15:00-17:00", venue: "三江南联球场", status: "ACTIVE", remark: "俱乐部选拔制", studentIds: ["s1", "s2"], active: true },
      { id: "c1516", name: "U8精英队", classType: "ELITE", ageGroup: "U8 / 2016", standardCapacity: 18, group: "乙组梯队", headCoachName: "游导", coachName: "游导", assistantCoachName: "", coachUserId: "coach1", schedule: "周一/三/五 19:00-20:30", venue: "瓯北中心小学", status: "ACTIVE", remark: "俱乐部选拔制", studentIds: ["s3", "s-growth"], active: true }
    ],
    sessions: [
      { id: "se1", classId: "c1718", title: "17/18精英班", date: "2026-08-20", weekday: "周四", time: "15:00-17:00", venue: "三江南联球场", coachName: "游导", focus: "一对一突破与攻防转换", capacity: 20, status: "published", enrollmentMode: "open" },
      { id: "se2", classId: "cinterest", title: "兴趣成长班", date: "2026-08-21", weekday: "周五", time: "19:00-20:30", venue: "瓯北中心小学", coachName: "王蒋生", focus: "球感、运球与小场比赛", capacity: 2, status: "published", enrollmentMode: "open" },
      { id: "se3", classId: "c1516", title: "15/16精英班", date: "2026-08-22", weekday: "周六", time: "09:00-11:00", venue: "瓯北中心小学", coachName: "游导", focus: "高压下的接应与传控", capacity: 18, status: "published", enrollmentMode: "fixed" }
    ],
    enrollments: [
      { id: "e1", sessionId: "se1", studentId: "s1", status: "booked", createdAt: "2026-08-18 10:00" },
      { id: "e2", sessionId: "se1", studentId: "s2", status: "booked", createdAt: "2026-08-18 10:10" },
      { id: "e3", sessionId: "se2", studentId: "s3", status: "booked", createdAt: "2026-08-18 11:00" },
      { id: "e4", sessionId: "se2", studentId: "s4", status: "booked", createdAt: "2026-08-18 11:10" },
      { id: "e5", sessionId: "se3", studentId: "s3", status: "booked", createdAt: "2026-08-18 12:00" }
    ],
    waitlist: [{ id: "w1", sessionId: "se2", studentId: "s1", status: "waiting", legacy: true, createdAt: "2026-08-18 12:20" }],
    leaveRequests: [{ id: "l1", sessionId: "se1", studentId: "s2", reason: "家庭安排冲突", status: "pending", createdAt: "2026-08-19 09:20" }],
    attendance: [
      { id: "a1", sessionId: "history1", classId: "c1718", studentId: "s1", date: "2026-08-18", status: "present", deductedLessons: 1 },
      { id: "a2", sessionId: "history1", classId: "c1718", studentId: "s2", date: "2026-08-18", status: "leave", deductedLessons: 0 }
    ],
    lessonLedger: [
      { id: "tx1", studentId: "s1", type: "purchase", delta: 28, balanceAfter: 28, referenceType: "renewal", referenceId: "seed1", note: "暑期一周两练课包", createdAt: "2026-07-01 10:00" },
      { id: "tx2", studentId: "s1", type: "attendance", delta: -1, balanceAfter: 19, referenceType: "attendance", referenceId: "a1", note: "17/18精英班到课", createdAt: "2026-08-18 17:10" },
      { id: "tx3", studentId: "s2", type: "purchase", delta: 28, balanceAfter: 28, referenceType: "renewal", referenceId: "seed2", note: "暑期一周两练课包", createdAt: "2026-07-01 10:05" }
    ],
    coursePackages: COURSE_PACKAGE_DEFAULTS.map((item) => ({ ...item, createdAt: "2026-08-25 09:00", updatedAt: "2026-08-25 09:00" })),
    orders: [],
    lessonEntitlements: [],
    lessonEntitlementEvents: [],
    lessonEntitlementAdjustments: [],
    sessionCancellationCompensations: [],
    feedback: [{ id: "f1", sessionId: "history1", studentId: "s1", coachName: "游导", rating: 4, tags: ["突破积极", "第一脚进步"], content: "敢于向前突破，下一阶段重点观察突破后的抬头和传球时机。", createdAt: "2026-08-18 18:00" }],
    renewals: [{ id: "r1", studentId: "s4", packageId: "p28", lessons: 28, amount: 1980, status: "pending", createdAt: "2026-08-18 14:20" }],
    eliteSelections: [
      { id: "es-pending", studentId: "s4", fromClassId: "cinterest", targetEliteClassId: "c1718", recommendationSource: "COACH_RECOMMENDATION", recommendedBy: "coach2", recommenderName: "王蒋生", recommendationReason: "训练态度积极，球感进步明显，建议跟训观察。", status: "PENDING", createdAt: "2026-08-19 10:00", updatedAt: "2026-08-19 10:00" },
      { id: "es-approved", studentId: "s1", fromClassId: "cu7base", targetEliteClassId: "c1718", recommendationSource: "COACH_RECOMMENDATION", recommendedBy: "coach1", recommenderName: "游导", recommendationReason: "1V1突破能力突出，比赛表现稳定。", status: "APPROVED", reviewedBy: "admin", reviewRemark: "同意入选并保留普通班", createdAt: "2026-08-10 10:00", reviewedAt: "2026-08-11 09:00", updatedAt: "2026-08-11 09:00" },
      { id: "es-rejected", studentId: "s3", fromClassId: "cu8advanced", targetEliteClassId: "c1516", recommendationSource: "COACH_RECOMMENDATION", recommendedBy: "coach1", recommenderName: "游导", recommendationReason: "建议进入精英队观察。", status: "REJECTED", reviewedBy: "admin", reviewRemark: "先继续提高班训练一个阶段", createdAt: "2026-08-08 10:00", reviewedAt: "2026-08-09 09:00", updatedAt: "2026-08-09 09:00" }
    ],
    auditLogs: []
  };
}

function load() {
  let data = wx.getStorageSync(STORAGE_KEY);
  if (!data || !data.sessions || !data.lessonLedger) { data = seed(); save(data); }
  if (!data.leads) { crm.ensure(data, today()); save(data); }
  ["orders", "lessonEntitlements", "lessonEntitlementEvents", "lessonEntitlementAdjustments", "sessionCancellationCompensations"].forEach((key) => { if (!Array.isArray(data[key])) data[key] = []; });
  if (!Array.isArray(data.coursePackages)) data.coursePackages = COURSE_PACKAGE_DEFAULTS.map((item) => ({ ...item, createdAt: stamp(), updatedAt: stamp() }));
  classesV3.ensure(data, { uid, stamp });
  growth.ensure(data);
  league.ensure(data);
  family.ensure(data, { stamp });
  coachProfiles.ensure(data);
  coachWork.ensure(data, { uid, stamp });
  training.ensure(data);
  save(data);
  return data;
}
function save(data) { wx.setStorageSync(STORAGE_KEY, data); }
function uid(prefix) { return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`; }
function stamp() { return `${today()} ${new Date().toTimeString().slice(0, 5)}`; }
function assertRole(role, allowed) { if (!allowed.includes(role)) throw new Error("没有执行该操作的权限"); }
function roleClassIds(data, role, userId = "coach1") { return role === "coach" ? (((data.users || []).find((item) => item.id === userId) || {}).classIds || []) : data.classes.map((item) => item.id); }
function visibleStudents(data, role, userId = "parent1") {
  if (role === "admin") return data.students;
  if (role === "parent") { const ids = family.linkedIds(data, userId); return data.students.filter((item) => ids.includes(item.id)); }
  const ids = roleClassIds(data, role, userId);
  return data.students.filter((student) => classesV3.activeClassIds(data, student.id).some((id) => ids.includes(id)));
}
function canAccessStudent(data, role, studentId, userId = "parent1") { return visibleStudents(data, role, userId).some((item) => item.id === studentId); }
function booked(data, sessionId) { return data.enrollments.filter((item) => item.sessionId === sessionId && item.status === "booked"); }
function sessionMemberIds(data, session) { return classesV3.activeMembers(data, session.classId).map((item) => item.studentId); }
function decorateSession(data, session, studentId) {
  const memberIds = sessionMemberIds(data, session);
  const count = memberIds.length;
  const trials = crm.trialCount(data, session.id);
  const clubClass = data.classes.find((item) => item.id === session.classId);
  const isMember = memberIds.includes(studentId);
  const leave = data.leaveRequests.filter((item) => item.sessionId === session.id && item.studentId === studentId).sort((a, b) => String(b.submittedAt || b.createdAt).localeCompare(String(a.submittedAt || a.createdAt)))[0];
  const records = data.attendance.filter((item) => item.sessionId === session.id && memberIds.includes(item.studentId));
  const attendanceStats = { expected: count, present: 0, leave: 0, injured: 0, absent: 0, unmarked: count };
  records.forEach((record) => { const key = record.status === "sick" ? "injured" : record.status; if (key in attendanceStats && key !== "expected" && key !== "unmarked") { attendanceStats[key] += 1; attendanceStats.unmarked = Math.max(0, attendanceStats.unmarked - 1); } });
  const leaveStatus = leave && leave.status === "pending" ? "leave_pending" : leave && leave.status === "approved" ? "leave_approved" : leave && leave.status === "rejected" ? "leave_rejected" : "";
  const standardCapacity = Number((clubClass || {}).standardCapacity || session.capacity || 20);
  const effectiveAssignments = coachWork.effectiveAssignments(session), primaryAssignment = effectiveAssignments.find((item) => item.role === "HEAD") || effectiveAssignments[0] || {};
  const replacement = session.replacementSessionId && data.sessions.find((item) => item.id === session.replacementSessionId);
  const makeupSession = replacement ? { id: replacement.id, title: replacement.title, date: replacement.date, weekday: replacement.weekday, time: replacement.time, venue: replacement.venue, coachName: replacement.coachName || "" } : null;
  return { ...coachWork.sessionView(data, session), makeupSession, coach: coachProfiles.coachReference(data, primaryAssignment.coachId || session.coachUserId || (clubClass || {}).headCoachUserId || (clubClass || {}).coachUserId, primaryAssignment.coachId ? "" : session.coachName || (clubClass || {}).headCoachName), className: (clubClass || {}).name || session.title || "", ageGroup: (clubClass || {}).ageGroup || "", standardCapacity, classType: (clubClass || {}).classType || "REGULAR", classTypeLabel: classesV3.CLASS_TYPES[(clubClass || {}).classType] || "普通班", memberCount: count, enrolledCount: count, trialCount: trials, totalCount: count + trials, overCapacity: Math.max(0, count - standardCapacity), isFull: count >= standardCapacity, attendanceStats, myStatus: leaveStatus || (isMember ? "booked" : "none"), leaveRequestId: leave ? leave.id : "" };
}
function publicSession(view) { const result = { ...view }; delete result.substitutionReason; delete result.schedulingConflictOverride; delete result.cancelReason; delete result.affectedStudentIds; delete result.compensationAppliedAt; delete result.plannedCoachAssignments; delete result.actualCoachAssignments; delete result.trainingNote; delete result.weeklyTrainingPlanId; delete result.trainingThemeKey; delete result.updatedBy; result.plannedCoaches = (result.plannedCoaches || []).map(({ coach, roleLabel }) => ({ coach, roleLabel })); result.actualCoaches = (result.actualCoaches || []).map(({ coach, roleLabel }) => ({ coach, roleLabel })); return result; }
function audit(data, role, action, targetType, targetId, detail) { const fields = detail && typeof detail === "object" ? detail : { detail: String(detail || "") }; data.auditLogs.unshift({ id: uid("log"), role, action, targetType, targetId, ...fields, createdAt: stamp() }); }
function appendLedger(data, studentId, delta, type, referenceType, referenceId, note) {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) throw new Error("未找到学员");
  student.remainingLessons = Number(student.remainingLessons || 0) + Number(delta || 0);
  const item = { id: uid("tx"), studentId, type, delta, balanceAfter: student.remainingLessons, referenceType, referenceId, note, createdAt: stamp() };
  data.lessonLedger.unshift(item);
  return item;
}
function dateOnly(value) { return String(value || "").slice(0, 10); }
function addDays(value, days) { const date = new Date(`${dateOnly(value)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + Number(days || 0)); return date.toISOString().slice(0, 10); }
function addMonths(value, months) { const source = new Date(`${dateOnly(value)}T12:00:00Z`); const day = source.getUTCDate(); source.setUTCDate(1); source.setUTCMonth(source.getUTCMonth() + Number(months || 0)); const last = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate(); source.setUTCDate(Math.min(day, last)); return source.toISOString().slice(0, 10); }
function entitlementStatusLabel(status) { return ({ UNACTIVATED: "未激活", ACTIVE: "使用中", EXHAUSTED: "已用完", EXPIRED: "已到期" })[status] || status; }
function entitlementView(item) { return { ...item, packageName: item.packageNameSnapshot || item.packageName || "课时套餐", purchasedLessons: Number(item.lessonCountSnapshot || item.totalLessons || item.purchasedLessons || 0), statusLabel: entitlementStatusLabel(item.status), activationMessage: item.status === "UNACTIVATED" ? "有效期将在首次正式训练消课后开始计算" : "", validityMessage: item.activatedAt ? `有效期至 ${item.expiresAt}` : "有效期将在首次正式训练消课后开始计算", priceYuan: (Number(item.priceFenSnapshot || 0) / 100).toFixed(2) }; }
function expireEntitlements(data, studentId, asOf = today()) {
  let expiredLessons = 0;
  data.lessonEntitlements.filter((item) => item.studentId === studentId && item.status === "ACTIVE" && item.expiresAt && dateOnly(item.expiresAt) < dateOnly(asOf)).forEach((item) => {
    const remaining = Number(item.remainingLessons || 0); item.status = "EXPIRED"; item.expiredAt = stamp(); item.updatedAt = stamp(); expiredLessons += remaining;
    data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: item.id, studentId, eventType: "EXPIRE", lessons: remaining, expiresAt: item.expiresAt, createdAt: stamp() });
    data.lessonLedger.unshift({ id: uid("tx"), studentId, entitlementId: item.id, type: "package_expired", delta: 0, balanceAfter: Math.max(0, Number((data.students.find((row) => row.id === studentId) || {}).remainingLessons || 0) - expiredLessons), referenceType: "lessonEntitlement", referenceId: item.id, note: `课时权益已到期，保留${remaining}节历史余额`, createdAt: stamp() });
  });
  if (expiredLessons) { const student = data.students.find((item) => item.id === studentId); student.remainingLessons = Math.max(0, Number(student.remainingLessons || 0) - expiredLessons); }
}
function applyEntitlementDelta(data, studentId, delta, context = {}) {
  const amount = Number(delta || 0); if (!amount) return { entitlementId: "" };
  expireEntitlements(data, studentId, context.date || today());
  const student = data.students.find((item) => item.id === studentId); if (!student) throw new Error("未找到学员");
  if (amount < 0) {
    const candidates = data.lessonEntitlements.filter((item) => item.studentId === studentId && Number(item.remainingLessons || 0) > 0 && ["ACTIVE", "UNACTIVATED"].includes(item.status)).sort((a, b) => (a.status === b.status ? String(a.expiresAt || a.createdAt).localeCompare(String(b.expiresAt || b.createdAt)) : a.status === "ACTIVE" ? -1 : 1));
    if (!candidates.length) { if (data.lessonEntitlements.some((item) => item.studentId === studentId)) throw new Error("当前没有可用课时权益，套餐可能已到期"); appendLedger(data, studentId, amount, context.type || "attendance", "session", context.referenceId || "", context.note || "正式训练消课"); return { entitlementId: "" }; }
    const item = candidates[0]; if (item.status === "UNACTIVATED") { const activatedAt = dateOnly(context.date || today()); item.status = "ACTIVE"; item.activatedAt = activatedAt; item.expiresAt = addDays(addMonths(activatedAt, item.validityMonthsSnapshot), Number(item.extensionDays || 0)); data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: item.id, studentId, eventType: "ACTIVATE", activatedAt, expiresAt: item.expiresAt, createdAt: stamp() }); }
    item.remainingLessons += amount; if (item.remainingLessons <= 0) item.status = "EXHAUSTED"; item.updatedAt = stamp(); appendLedger(data, studentId, amount, context.type || "attendance", "session", context.referenceId || "", context.note || "正式训练消课").entitlementId = item.id; data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: item.id, studentId, eventType: "DEDUCT", lessons: Math.abs(amount), sourceSessionId: context.referenceId || "", createdAt: stamp() }); return { entitlementId: item.id };
  }
  const item = data.lessonEntitlements.find((row) => row.id === context.entitlementId && row.studentId === studentId); if (item) { item.remainingLessons += amount; if (item.status === "EXHAUSTED") item.status = item.activatedAt ? "ACTIVE" : "UNACTIVATED"; item.updatedAt = stamp(); appendLedger(data, studentId, amount, context.type || "attendance_adjustment", "session", context.referenceId || "", context.note || "课时校正").entitlementId = item.id; data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: item.id, studentId, eventType: "RESTORE", lessons: amount, sourceSessionId: context.referenceId || "", createdAt: stamp() }); return { entitlementId: item.id }; }
  appendLedger(data, studentId, amount, context.type || "attendance_adjustment", "session", context.referenceId || "", context.note || "课时校正"); return { entitlementId: "" };
}
function applyAttendanceRecord(data, session, studentId, status, context = {}) {
  if (!(status in DEDUCTION)) throw new Error("无效出勤状态");
  const existing = data.attendance.find((item) => item.sessionId === session.id && item.studentId === studentId);
  const oldStatus = existing ? existing.status : "unmarked";
  const previous = existing ? Number(existing.deductedLessons || 0) : 0;
  const next = DEDUCTION[status];
  const updatedAt = stamp();
  const lessonDelta = previous - next;
  const entitlement = lessonDelta ? applyEntitlementDelta(data, studentId, lessonDelta, { entitlementId: existing && existing.entitlementId, date: session.date || context.date, referenceId: session.id, type: context.ledgerType || (lessonDelta < 0 ? "attendance" : "attendance_adjustment"), note: context.note || `${session.title}${status === "present" ? "到课" : status === "absent" ? "缺勤" : "状态校正"}` }) : { entitlementId: existing && existing.entitlementId || "" };
  if (existing) Object.assign(existing, { status, deductedLessons: next, entitlementId: entitlement.entitlementId || existing.entitlementId || "", source: context.source || existing.source || "ATTENDANCE", leaveRequestId: context.leaveRequestId || existing.leaveRequestId || "", operatorId: context.operatorId || existing.operatorId || "", updatedAt });
  else data.attendance.push({ id: uid("a"), sessionId: session.id, classId: session.classId, studentId, date: session.date || context.date, status, deductedLessons: next, entitlementId: entitlement.entitlementId || "", source: context.source || "ATTENDANCE", leaveRequestId: context.leaveRequestId || "", operatorId: context.operatorId || "", createdAt: updatedAt, updatedAt });
  return { oldStatus, newStatus: status, lessonDelta };
}
function cancelLocalSession(data, input, role, userId) {
  assertRole(role, ["admin"]); const session = data.sessions.find((item) => item.id === input.sessionId); if (!session) throw new Error("课程不存在");
  const reasonLabels = { WEATHER: "天气原因", VENUE: "场地原因", COACH: "教练原因", CLUB: "俱乐部原因", FORCE_MAJEURE: "不可抗力", OTHER: "其他原因" };
  const legacyReason = String(input.reason || ""); const inferredReasonCode = legacyReason.includes("天气") ? "WEATHER" : legacyReason.includes("场地") ? "VENUE" : legacyReason.includes("教练") ? "COACH" : legacyReason.includes("俱乐部") ? "CLUB" : legacyReason.includes("不可抗力") ? "FORCE_MAJEURE" : "OTHER"; const reasonCode = String(input.reasonCode || inferredReasonCode).toUpperCase(); if (!reasonLabels[reasonCode]) throw new Error("请选择有效取消原因");
  const defaultType = ["WEATHER", "VENUE", "CLUB"].includes(reasonCode) ? "EXTEND_VALIDITY" : "NO_COMPENSATION";
  const compensationType = String(input.compensationType || defaultType); if (!["EXTEND_VALIDITY", "MAKEUP_SESSION", "NO_COMPENSATION"].includes(compensationType)) throw new Error("请选择有效补偿方式");
  const extensionDays = compensationType === "EXTEND_VALIDITY" ? Math.max(1, Number(input.extensionDays || 7)) : 0;
  const existing = data.sessionCancellationCompensations.find((item) => item.sessionId === session.id); if (existing) return { ok: true, idempotent: true, compensation: existing };
  let replacement = null; if (compensationType === "MAKEUP_SESSION") { replacement = data.sessions.find((item) => item.id === input.replacementSessionId); if (!replacement || replacement.classId !== session.classId || replacement.status === "CANCELLED") throw new Error("请选择同一班级的有效补课课程"); }
  const affectedStudentIds = classesV3.activeMembers(data, session.classId).map((item) => item.studentId); const adjustments = [];
  if (compensationType === "EXTEND_VALIDITY") affectedStudentIds.forEach((studentId) => {
    expireEntitlements(data, studentId); const entitlement = data.lessonEntitlements.filter((item) => item.studentId === studentId && Number(item.remainingLessons || 0) > 0 && ["ACTIVE", "UNACTIVATED"].includes(item.status)).sort((a, b) => a.status === "ACTIVE" ? -1 : 1)[0]; if (!entitlement) return;
    const oldExpiresAt = entitlement.expiresAt || ""; entitlement.extensionDays = Number(entitlement.extensionDays || 0) + extensionDays; if (entitlement.status === "ACTIVE") entitlement.expiresAt = addDays(entitlement.expiresAt, extensionDays); entitlement.updatedAt = stamp();
    const adjustment = { id: uid("lea"), entitlementId: entitlement.id, studentId, adjustmentType: "SESSION_CANCELLATION_EXTENSION", oldExpiresAt, extensionDays, newExpiresAt: entitlement.expiresAt || "", reason: `${reasonLabels[reasonCode]}停课`, sourceSessionId: session.id, operatorId: userId, createdAt: stamp() }; data.lessonEntitlementAdjustments.unshift(adjustment); adjustments.push(adjustment);
    data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: entitlement.id, studentId, eventType: "EXTEND_VALIDITY", extensionDays, sourceSessionId: session.id, createdAt: stamp() });
    data.lessonLedger.unshift({ id: uid("tx"), studentId, entitlementId: entitlement.id, type: "validity_extension", delta: 0, balanceAfter: Number((data.students.find((item) => item.id === studentId) || {}).remainingLessons || 0), referenceType: "session", referenceId: session.id, note: `${reasonLabels[reasonCode]}停课，本次未扣课，有效期顺延${extensionDays}天`, createdAt: stamp() });
  });
  const compensation = { id: uid("scc"), sessionId: session.id, classId: session.classId, reasonCode, reasonLabel: reasonLabels[reasonCode], compensationType, extensionDays, replacementSessionId: replacement ? replacement.id : "", affectedStudentIds, adjustmentIds: adjustments.map((item) => item.id), operatorId: userId, createdAt: stamp() }; data.sessionCancellationCompensations.push(compensation);
  Object.assign(session, { status: "CANCELLED", cancelReason: String(input.reason || input.reasonDetail || reasonLabels[reasonCode]), cancelReasonCode: reasonCode, cancelReasonLabel: reasonLabels[reasonCode], compensationType, compensationExtensionDays: extensionDays, replacementSessionId: replacement ? replacement.id : "", affectedStudentIds, cancelledAt: stamp(), cancelledBy: userId }); if (replacement) replacement.makeupForSessionId = session.id;
  audit(data, role, "CANCEL_SESSION", "session", session.id, { reasonCode, compensationType, extensionDays, replacementSessionId: replacement ? replacement.id : "", affectedStudentIds }); save(data); return { ok: true, idempotent: false, affectedCount: affectedStudentIds.length, adjustmentCount: adjustments.length, compensation };
}
function saveStudentRecord(data, payload) {
  let studentId = payload.id;
  if (studentId) { const index = data.students.findIndex((item) => item.id === studentId); if (index < 0) throw new Error("学员不存在"); const old = data.students[index]; data.students[index] = { ...old, ...payload, remainingLessons: old.remainingLessons, totalLessons: old.totalLessons }; }
  else { const lessons = Math.max(0, Number(payload.remainingLessons || 0)); studentId = uid("s"); data.students.push({ ...payload, id: studentId, remainingLessons: lessons, totalLessons: lessons, classIds: payload.classIds || [], status: "active" }); if (lessons) data.lessonLedger.unshift({ id: uid("tx"), studentId, type: "opening", delta: lessons, balanceAfter: lessons, referenceType: "student", referenceId: studentId, note: "建档期初课时", createdAt: stamp() }); }
  return { id: studentId };
}
async function call(action, input = {}) {
  const data = load();
  const role = input.previewRole || "admin";
  const userId = role === "admin" ? "admin" : role === "coach" ? input.previewUserId || "coach1" : input.previewUserId || "parent1";
  const userRecord = (data.users || []).find((item) => item.id === userId);
  const userName = (userRecord || {}).name || (role === "admin" ? "南联管理员" : role === "coach" ? "游导" : "待绑定家长");
  const ownStudentId = visibleStudents(data, role, userId)[0] && visibleStudents(data, role, userId)[0].id;
  const classContext = { data, role, userId, userName, uid, stamp, canAccessStudent: (studentId) => canAccessStudent(data, role, studentId, userId), canAccessClass: (classId) => role === "admin" || roleClassIds(data, role, userId).includes(classId), audit: (nextAction, targetType, targetId, detail) => audit(data, role, nextAction, targetType, targetId, detail), save: () => save(data) };
  if (classesV3.handles(action)) return classesV3.call(action, input, classContext);
  if (crm.handles(action)) return crm.call(action, input, { data, role, userId, userName, today: today(), uid, stamp, audit, save, packages: PACKAGES, createStudent: async (student) => { const classIds = student.classIds || []; const result = saveStudentRecord(data, { ...student, classIds: [] }); for (const classId of classIds) await classesV3.call("addClassMember", { classId, studentId: result.id, source: "ADMIN_ADD", confirmCapacity: true, remark: "CRM转正式学员编班" }, classContext); return result; } });
  if (growth.handles(action)) return growth.call(action, input, classContext);
  if (league.handles(action)) return league.call(action, input, classContext);
  if (family.handles(action)) return family.call(action, input, classContext);
  if (coachProfiles.handles(action)) return coachProfiles.call(action, input, classContext);
  if (training.handles(action)) return training.call(action, input, classContext);
  if (action === "cancelSession") return cancelLocalSession(data, input, role, userId);
  if (coachWork.handles(action)) return coachWork.call(action, input, classContext);
  if (timetable.handles(action)) return timetable.call(action, input, classContext);
  switch (action) {
    case "getContext": return { mode: "local", user: { id: userId, name: userName, role }, needsBinding: false };
    case "getDashboard": {
      let students = visibleStudents(data, role, userId); if (role === "parent" && input.activeStudentId) { if (!canAccessStudent(data, role, input.activeStudentId, userId)) throw new Error("无权访问该学员"); students = students.filter((item) => item.id === input.activeStudentId); } const ids = students.map((item) => item.id); const classIds = roleClassIds(data, role, userId);
      const parentClassIds = students[0] ? classesV3.activeClassIds(data, students[0].id) : [];
      const classes = data.classes.filter((item) => role === "parent" ? parentClassIds.includes(item.id) : classIds.includes(item.id));
      const selectedStudentId = role === "parent" ? (students[0] || {}).id : ownStudentId; const selectedClassIds = selectedStudentId ? classesV3.activeClassIds(data, selectedStudentId) : []; const sessions = data.sessions.filter((item) => ["published", "COMPLETED", "CANCELLED"].includes(item.status) && (role !== "coach" || coachWork.effectiveAssignments(item).some((entry) => entry.coachId === userId)) && (role !== "parent" || selectedClassIds.includes(item.classId))).map((item) => role === "parent" ? publicSession(decorateSession(data, item, selectedStudentId)) : decorateSession(data, item, selectedStudentId));
      return { role, studentCount: students.length, classCount: classes.length, lowBalance: students.filter((item) => item.remainingLessons <= 5).length, pendingRenewals: data.renewals.filter((item) => item.status === "pending" && (role === "admin" || ids.includes(item.studentId))).length, todayAttendance: data.attendance.filter((item) => item.date === today() && ids.includes(item.studentId)).length, pendingLeaves: data.leaveRequests.filter((item) => item.status === "pending" && (role === "admin" || ids.includes(item.studentId) || classIds.includes((data.sessions.find((s) => s.id === item.sessionId) || {}).classId))).length, recentStudents: [...students].sort((a, b) => a.remainingLessons - b.remainingLessons).slice(0, 3).map((item) => ({ ...item, initial: item.name[0] })), classes, sessions: sessions.slice(0, 4) };
    }
    case "getOperationsDashboard": {
      assertRole(role, ["admin", "coach"]); const classIds = roleClassIds(data, role, userId);
      const sessions = data.sessions.filter((item) => role === "admin" || classIds.includes(item.classId));
      return { metrics: { students: visibleStudents(data, role, userId).length, sessions: sessions.length, classMembers: (data.classMembers || []).filter((item) => item.status === "ACTIVE").length, pendingEvaluations: sessions.filter((session) => !(data.feedback || []).some((item) => item.sessionId === session.id)).length, pendingLeaves: data.leaveRequests.filter((item) => item.status === "pending").length, pendingRenewals: data.renewals.filter((item) => item.status === "pending").length }, alerts: [{ level: "warning", text: "三江秋季周一/三/五场地时段待确认" }, { level: "danger", text: `${data.students.filter((item) => item.remainingLessons <= 5).length}名学员剩余课时不足5节` }, { level: "info", text: "兼职教练证书等级和有效期需要补录" }], sessions: sessions.map((item) => decorateSession(data, item, ownStudentId)), auditLogs: data.auditLogs.slice(0, 20) };
    }
    case "listStudents": return visibleStudents(data, role, userId).map((student) => { const classIds = classesV3.activeClassIds(data, student.id), ownClasses = data.classes.filter((item) => classIds.includes(item.id)); return { ...student, ownerParentUserId: role === "admin" ? student.ownerParentUserId || "" : undefined, classIds, initial: student.name[0], classNames: ownClasses.map((item) => item.name).join("、"), classes: ownClasses.map((item) => ({ id: item.id, name: item.name, classType: item.classType || "REGULAR", classTypeLabel: item.classType === "ELITE" ? "精英队" : "普通班", schedule: item.schedule || "", venue: item.venue || "", memberStatus: "ACTIVE", memberStatusLabel: "正式成员" })) }; });
    case "getStudent": {
      if (!canAccessStudent(data, role, input.id, userId)) throw new Error("无权查看该学员");
      const student = data.students.find((item) => item.id === input.id);
      const lead = data.leads.find((item) => item.id === student.crmLeadId || item.convertedStudentId === student.id); const trial = lead && data.trialBookings.filter((item) => item.leadId === lead.id).sort((a, b) => b.trialDate.localeCompare(a.trialDate))[0];
      const activeIds = classesV3.activeClassIds(data, student.id); const selections = (data.eliteSelections || []).filter((item) => item.studentId === student.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const latestSelection = selections[0]; const recommendationStatus = !latestSelection ? "NONE" : latestSelection.status === "APPROVED" ? "SELECTED" : latestSelection.status === "PENDING" ? "RECOMMENDED" : "WATCH";
      if (role !== "coach") expireEntitlements(data, student.id);
      return { ...student, classIds: activeIds, initial: student.name[0], classes: data.classes.filter((item) => activeIds.includes(item.id)).map((item) => classesV3.decorateClass(data, item)), eliteSelections: selections.map((item) => ({ ...item, targetClass: data.classes.find((clubClass) => clubClass.id === item.targetEliteClassId), statusLabel: classesV3.SELECTION_STATUS[item.status] || item.status })), eliteRecommendationStatus: recommendationStatus, attendance: data.attendance.filter((item) => item.studentId === input.id).sort((a, b) => b.date.localeCompare(a.date)), renewals: role === "coach" ? [] : data.renewals.filter((item) => item.studentId === input.id), lessonEntitlements: role === "coach" ? [] : data.lessonEntitlements.filter((item) => item.studentId === input.id).map(entitlementView), feedback: data.feedback.filter((item) => item.studentId === input.id && (role !== "parent" || item.visibility !== "STAFF_ONLY")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), lessonLedger: role === "coach" ? [] : data.lessonLedger.filter((item) => item.studentId === input.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), recruitment: lead ? { source: lead.source, ownerCoachName: lead.ownerCoachName, firstContactAt: lead.createdAt, trialDate: (trial || {}).trialDate || "", trialCoachName: (trial || {}).coachName || "", trialFeedback: ((trial || {}).feedback || {}).summary || "", convertedAt: lead.convertedAt } : null };
    }
    case "saveStudent": {
      assertRole(role, ["admin"]); const payload = input.student || {};
      if (!payload.id && !payload.avatarUrl) throw new Error("请上传孩子本人照片");
      const result = saveStudentRecord(data, payload); audit(data, role, "saveStudent", "student", result.id, payload.name); save(data); return { ok: true, id: result.id };
    }
    case "listClasses": {
      return data.classes.filter((item) => item.status === "ACTIVE" && (role === "admin" || role === "parent" || roleClassIds(data, role, userId).includes(item.id))).map((item) => classesV3.decorateClass(data, item));
    }
    case "listClassCoaches": {
      assertRole(role, ["admin", "coach"]);
      const coaches = (data.users || []).filter((item) => item.role === "coach");
      return (role === "coach" ? coaches.filter((item) => item.id === userId) : coaches).map((item) => ({ id: item.id, name: item.name }));
    }
    case "getClass": {
      assertRole(role, ["admin", "coach"]); const clubClass = data.classes.find((item) => item.id === input.id);
      if (!clubClass) throw new Error("班级不存在");
      if (role === "coach" && !roleClassIds(data, role, userId).includes(clubClass.id)) throw new Error("无权编辑该班级");
      return classesV3.decorateClass(data, clubClass);
    }
    case "saveClass": {
      assertRole(role, ["admin", "coach"]); const payload = input.clubClass; let classId = payload.id;
      const previous = classId && data.classes.find((item) => item.id === classId);
      if (role === "coach" && previous && !roleClassIds(data, role, userId).includes(classId)) throw new Error("无权编辑该班级");
      const headCoachUserId = role === "coach" ? userId : String(payload.headCoachUserId || "");
      const headCoach = (data.users || []).filter((item) => item.id === headCoachUserId && item.role === "coach").slice(-1)[0];
      if (!headCoach) throw new Error("请选择已绑定的主教练");
      const scheduleSlots = Array.isArray(payload.scheduleSlots) ? payload.scheduleSlots.map((slot) => ({ weekday: String(slot.weekday || ""), startTime: String(slot.startTime || ""), endTime: String(slot.endTime || "") })).filter((slot) => slot.weekday && slot.startTime && slot.endTime && slot.startTime < slot.endTime) : [];
      const schedule = scheduleSlots.length ? scheduleSlots.map((slot) => `${slot.weekday} ${slot.startTime}-${slot.endTime}`).join(" / ") : String(payload.schedule || "").trim();
      const assistantCoachIds = role === "admin" ? [...new Set((payload.assistantCoachIds || []).filter((id) => id && id !== headCoachUserId))] : (previous || {}).assistantCoachIds || [];
      if (assistantCoachIds.some((id) => !(data.users || []).some((item) => item.id === id && item.role === "coach" && item.active !== false))) throw new Error("助理教练账号无效");
      const normalized = { ...payload, classType: payload.classType === "ELITE" ? "ELITE" : "REGULAR", ageGroup: String(payload.ageGroup || "").trim(), standardCapacity: Math.max(1, Number(payload.standardCapacity || 20)), headCoachUserId, coachUserId: headCoachUserId, headCoachName: headCoach.name, coachName: headCoach.name, assistantCoachIds, assistantCoachName: assistantCoachIds.map((id) => ((data.users || []).find((item) => item.id === id) || {}).name).filter(Boolean).join("、"), schedule, scheduleSlots, venue: String(payload.venue || "").trim(), status: payload.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", active: payload.status !== "INACTIVE", remark: String(payload.remark || "").trim() };
      if (!normalized.name || !normalized.ageGroup || !normalized.headCoachName || !normalized.schedule || !normalized.venue) throw new Error("请完整填写班级信息");
      const previousType = previous && previous.classType; const previousCoachUserId = previous && (previous.headCoachUserId || previous.coachUserId); const isNew = !classId; if (classId) Object.assign(previous, normalized); else { classId = uid("c"); data.classes.push({ ...normalized, id: classId, studentIds: [] }); }
      headCoach.classIds = [...new Set([...(headCoach.classIds || []), classId])];
      assistantCoachIds.forEach((id) => { const coach = data.users.find((item) => item.id === id); coach.classIds = [...new Set([...(coach.classIds || []), classId])]; });
      ((previous || {}).assistantCoachIds || []).filter((id) => !assistantCoachIds.includes(id)).forEach((id) => { const coach = data.users.find((item) => item.id === id); if (coach) coach.classIds = (coach.classIds || []).filter((item) => item !== classId); });
      if (previousCoachUserId && previousCoachUserId !== headCoachUserId) { const oldCoach = (data.users || []).find((item) => item.id === previousCoachUserId); if (oldCoach) oldCoach.classIds = (oldCoach.classIds || []).filter((id) => id !== classId); }
      audit(data, role, previousType && previousType !== normalized.classType ? "changeClassType" : isNew ? "createClass" : "saveClass", "class", classId, { operator: userId, toClassId: classId, reason: normalized.name }); save(data); return { id: classId };
    }
    case "listSessions": {
      const studentId = input.studentId || ownStudentId;
      if (role === "parent" && studentId && !canAccessStudent(data, role, studentId, userId)) throw new Error("无权访问该学员");
      const parentClassIds = role === "parent" && studentId ? classesV3.activeClassIds(data, studentId) : [];
      return data.sessions.filter((item) => (["published", "COMPLETED", "CANCELLED"].includes(item.status) || role !== "parent") && (role !== "coach" || coachWork.effectiveAssignments(item).some((entry) => entry.coachId === userId)) && (role !== "parent" || parentClassIds.includes(item.classId))).map((item) => role === "parent" ? publicSession(decorateSession(data, item, studentId)) : decorateSession(data, item, studentId));
    }
    case "getSession": {
      const session = data.sessions.find((item) => item.id === input.id); if (!session) throw new Error("课程不存在");
      if (role === "parent" && !["published", "COMPLETED", "CANCELLED"].includes(session.status)) throw new Error("课程尚未发布");
      if (role === "coach" && !coachWork.effectiveAssignments(session).some((entry) => entry.coachId === userId)) throw new Error("无权查看该课程");
      const studentId = input.studentId || ownStudentId; if (role === "parent") { if (!studentId || !canAccessStudent(data, role, studentId, userId)) throw new Error("无权访问该学员"); if (!classesV3.activeMembers(data, session.classId).some((item) => item.studentId === studentId)) throw new Error("该学员不是本课程班级成员"); } const result = role === "parent" ? publicSession(decorateSession(data, session, studentId)) : decorateSession(data, session, studentId);
      return { ...result, enrollments: sessionMemberIds(data, session).map((studentId) => ({ id: `${session.id}-${studentId}`, sessionId: session.id, studentId, attendanceStatus: (data.attendance.find((record) => record.sessionId === session.id && record.studentId === studentId) || {}).status || "unmarked", student: data.students.find((s) => s.id === studentId) })), trialStudents: data.trialBookings.filter((item) => item.sessionId === session.id && ["SCHEDULED", "COMPLETED", "NO_SHOW"].includes(item.status)).map((item) => ({ id: item.id, trialId: item.id, name: item.childName, initial: item.childName[0], attendanceStatus: item.attendanceStatus || "unmarked", isTrial: true, status: item.status })) };
    }
    case "saveSession": {
      assertRole(role, ["admin"]); const payload = input.session || {}; if (!payload.title || !payload.date || !payload.time || !payload.venue) throw new Error("课程信息不完整");
      if (payload.id && (data.sessions.find((item) => item.id === payload.id) || {}).status === "COMPLETED") throw new Error("已完成课程只能通过课时更正流程修改教练");
      const previous = payload.id ? data.sessions.find((item) => item.id === payload.id) : null; if (payload.id && !previous) throw new Error("课程不存在");
      const editable = { id: payload.id, classId: payload.classId, title: payload.title, date: payload.date, weekday: payload.weekday, time: payload.time, venue: payload.venue, venueId: payload.venueId || "", trainingTheme: payload.trainingTheme || "", trainingThemeKey: payload.trainingThemeKey || "", trainingFocus: payload.trainingFocus || payload.focus || "", trainingNote: payload.trainingNote || "", weeklyTrainingPlanId: payload.weeklyTrainingPlanId || "", focus: payload.focus || payload.trainingFocus || "", capacity: payload.capacity, enrollmentMode: payload.enrollmentMode, status: payload.status, publishStatus: payload.publishStatus, plannedCoachAssignments: payload.plannedCoachAssignments, forceConflict: payload.forceConflict, conflictReason: payload.conflictReason };
      const prepared = coachWork.prepareSession(data, editable, previous, classContext); if (prepared.confirmationRequired) return prepared;
      let id = payload.id; if (previous) Object.assign(previous, prepared.session); else { id = uid("se"); data.sessions.push({ ...prepared.session, id, status: payload.status || "published", capacity: Number(payload.capacity || 20), createdAt: stamp() }); }
      audit(data, role, "saveSession", "session", id, { title: payload.title, plannedCoachAssignments: prepared.session.plannedCoachAssignments }); save(data); return { ok: true, id };
    }
    case "enrollSession": {
      assertRole(role, ["admin", "parent"]); const studentId = input.studentId || ownStudentId;
      if (!canAccessStudent(data, role, studentId, userId)) throw new Error("无权为该学员报名");
      const session = data.sessions.find((item) => item.id === input.sessionId); const student = data.students.find((item) => item.id === studentId);
      if (!session || session.status !== "published") throw new Error("课程暂不可报名"); const sessionClass = data.classes.find((item) => item.id === session.classId); if (role === "parent" && sessionClass && sessionClass.classType === "ELITE") throw new Error("精英队课程实行俱乐部选拔制"); if (student.remainingLessons <= 0) throw new Error("剩余课时不足，请先续费");
      const existing = classesV3.activeMembers(data, session.classId).find((item) => item.studentId === studentId); if (existing) return { status: "booked", message: "已经是本班正式成员" };
      const joined = await classesV3.call("joinClass", { classId: session.classId, studentId }, classContext); return { status: joined.status === "FULL" ? "full" : "booked", message: joined.message };
    }
    case "requestLeave": {
      assertRole(role, ["admin", "parent"]); const studentId = input.studentId || ownStudentId;
      if (!canAccessStudent(data, role, studentId, userId)) throw new Error("无权提交该学员请假");
      const leaveSession = data.sessions.find((item) => item.id === input.sessionId); if (!leaveSession || !sessionMemberIds(data, leaveSession).includes(studentId)) throw new Error("该学员不是本班正式成员");
      if (data.leaveRequests.some((item) => item.sessionId === input.sessionId && item.studentId === studentId && item.status === "pending")) throw new Error("请假申请已提交"); if (data.leaveRequests.some((item) => item.sessionId === input.sessionId && item.studentId === studentId && item.status === "approved")) throw new Error("该课程请假已经批准");
      const submittedAt = stamp(); const request = { id: uid("l"), sessionId: input.sessionId, classId: leaveSession.classId, studentId, reason: String(input.reason || "家长请假"), status: "pending", submittedAt, createdAt: submittedAt, creatorId: userId }; data.leaveRequests.push(request); audit(data, role, "requestLeave", "leave", request.id, { studentId, sessionId: request.sessionId, leaveRequestId: request.id, operator: userId, oldStatus: "NONE", newStatus: "pending", lessonDelta: 0 }); save(data); return { ok: true, id: request.id };
    }
    case "cancelLeave": {
      assertRole(role, ["admin", "parent"]); const request = data.leaveRequests.find((item) => item.id === input.id); if (!request) throw new Error("请假申请不存在"); if (!canAccessStudent(data, role, request.studentId, userId)) throw new Error("无权撤销该请假");
      if (request.status === "cancelled") return { ok: true, status: "cancelled", idempotent: true }; if (request.status === "approved") throw new Error("已批准请假请联系俱乐部管理员处理"); if (request.status !== "pending") throw new Error("当前请假状态不可撤销");
      request.status = "cancelled"; request.cancelledAt = stamp(); request.cancelledBy = userId; audit(data, role, "cancelLeave", "leave", request.id, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: request.id, operator: userId, oldStatus: "pending", newStatus: "cancelled", lessonDelta: 0 }); save(data); return { ok: true, status: "cancelled" };
    }
    case "listLeaveRequests": {
      const ids = visibleStudents(data, role, userId).map((item) => item.id); const classIds = roleClassIds(data, role, userId);
      if (role === "parent" && input.studentId && !ids.includes(input.studentId)) throw new Error("无权访问该学员"); return data.leaveRequests.filter((item) => role === "admin" || (role === "parent" ? ids.includes(item.studentId) && (!input.studentId || item.studentId === input.studentId) : classIds.includes((data.sessions.find((s) => s.id === item.sessionId) || {}).classId))).map((item) => { const session = data.sessions.find((s) => s.id === item.sessionId); return { ...item, submittedAt: item.submittedAt || item.createdAt, student: data.students.find((s) => s.id === item.studentId), session, clubClass: data.classes.find((clubClass) => clubClass.id === (item.classId || (session || {}).classId)) }; }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    }
    case "reviewLeave": {
      assertRole(role, ["admin"]); const request = data.leaveRequests.find((item) => item.id === input.id); if (!request) throw new Error("请假申请不存在"); const status = input.approved ? "approved" : "rejected";
      if (request.status === status) return { ok: true, status, idempotent: true, lessonDelta: 0, promotedStudentId: null }; if (request.status !== "pending") throw new Error("申请状态已变化");
      const leaveSession = data.sessions.find((item) => item.id === request.sessionId); if (!leaveSession) throw new Error("课程不存在"); let correction = { oldStatus: "unmarked", newStatus: "unmarked", lessonDelta: 0 };
      if (input.approved) correction = applyAttendanceRecord(data, leaveSession, request.studentId, "leave", { source: "LEAVE_APPROVAL", leaveRequestId: request.id, operatorId: userId, ledgerType: "leave_correction", note: `${leaveSession.title}请假审批课时返还` });
      request.status = status; request.reviewedAt = stamp(); request.reviewerId = userId; request.reviewNote = input.note || "";
      audit(data, role, input.approved ? "approveLeave" : "rejectLeave", "leave", request.id, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: request.id, operator: userId, oldStatus: "pending", newStatus: status, attendanceOldStatus: correction.oldStatus, attendanceNewStatus: correction.newStatus, lessonDelta: correction.lessonDelta });
      if (correction.lessonDelta) audit(data, role, "leaveLessonCorrection", "student", request.studentId, { studentId: request.studentId, sessionId: request.sessionId, leaveRequestId: request.id, operator: userId, oldStatus: correction.oldStatus, newStatus: "leave", lessonDelta: correction.lessonDelta });
      save(data); return { ok: true, status, idempotent: false, lessonDelta: correction.lessonDelta, promotedStudentId: null };
    }
    case "getAttendanceSheet": {
      assertRole(role, ["admin", "coach"]); let session = input.sessionId ? data.sessions.find((item) => item.id === input.sessionId) : data.sessions.find((item) => item.classId === input.classId && item.date === input.date);
      if (!session) session = { id: `adhoc-${input.classId}-${input.date}`, classId: input.classId, date: input.date, title: (data.classes.find((c) => c.id === input.classId) || {}).name || "临时课程" };
      if (role === "coach" && !roleClassIds(data, role, userId).includes(session.classId)) throw new Error("无权点名该班级");
      const ids = sessionMemberIds(data, session);
      const trialStudents = data.trialBookings.filter((item) => item.sessionId === session.id && ["SCHEDULED", "COMPLETED", "NO_SHOW"].includes(item.status)).map((item) => ({ id: item.id, trialId: item.id, name: item.childName, initial: item.childName[0], attendanceStatus: item.attendanceStatus || "unmarked", isTrial: true }));
      return { session, clubClass: data.classes.find((item) => item.id === session.classId), date: session.date, students: ids.map((studentId) => { const student = data.students.find((item) => item.id === studentId); const record = data.attendance.find((item) => item.sessionId === session.id && item.studentId === studentId); const approvedLeave = data.leaveRequests.find((item) => item.sessionId === session.id && item.studentId === studentId && item.status === "approved"); const attendanceStatus = record ? record.status : "unmarked"; return { ...student, initial: student.name[0], attendanceStatus, leaveApproved: Boolean(approvedLeave), leaveRequestId: approvedLeave ? approvedLeave.id : "", leaveLocked: Boolean(approvedLeave && attendanceStatus === "leave"), leaveOverride: Boolean(approvedLeave && attendanceStatus !== "leave") }; }), trialStudents };
    }
    case "submitAttendance": {
      assertRole(role, ["admin", "coach"]); const session = data.sessions.find((item) => item.id === input.sessionId) || { id: input.sessionId || `adhoc-${input.classId}-${input.date}`, classId: input.classId, date: input.date, title: "临时课程" };
      if (session.status === "CANCELLED") throw new Error("已取消课程不能点名或消课");
      if (role === "coach" && !roleClassIds(data, role, userId).includes(session.classId)) throw new Error("无权点名该班级");
      const allowedIds = sessionMemberIds(data, session); const allowed = new Set(allowedIds);
      (input.records || []).forEach((record) => { if (!allowed.has(record.studentId)) throw new Error("点名名单包含非报名学员"); const approvedLeave = data.leaveRequests.find((item) => item.sessionId === session.id && item.studentId === record.studentId && item.status === "approved"); if (approvedLeave && record.status !== "leave" && !record.overrideApprovedLeave) throw new Error("已批准请假，修改状态前需要确认"); const correction = applyAttendanceRecord(data, session, record.studentId, record.status, { operatorId: userId, source: approvedLeave ? (record.status === "leave" ? "LEAVE_APPROVAL" : "LEAVE_ADMIN_OVERRIDE") : "ATTENDANCE", leaveRequestId: approvedLeave ? approvedLeave.id : "" }); if (approvedLeave && record.status !== "leave") audit(data, role, "overrideApprovedLeaveAttendance", "attendance", record.studentId, { studentId: record.studentId, sessionId: session.id, leaveRequestId: approvedLeave.id, operator: userId, oldStatus: correction.oldStatus, newStatus: correction.newStatus, lessonDelta: correction.lessonDelta }); });
      crm.applyTrialAttendance(data, session.id, input.trialRecords, { today: today(), stamp });
      audit(data, role, "submitAttendance", "session", session.id, `${(input.records || []).length}人`); save(data); return { ok: true };
    }
    case "getLessonLedger": { if (!canAccessStudent(data, role, input.studentId, userId)) throw new Error("无权查看课时"); return data.lessonLedger.filter((item) => item.studentId === input.studentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    case "listCoursePackages": {
      if (role === "coach") throw new Error("教练无套餐财务权限");
      return data.coursePackages.filter((item) => role === "admin" || item.status === "ACTIVE").sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map((item) => ({ ...item, priceYuan: (Number(item.priceFen || 0) / 100).toFixed(2) }));
    }
    case "saveCoursePackage": {
      assertRole(role, ["admin"]); const payload = input.item || {}; const lessonCount = Number(payload.lessonCount), priceFen = Math.round(Number(payload.priceYuan) * 100), validityMonths = Number(payload.validityMonths); if (!String(payload.name || "").trim() || !Number.isInteger(lessonCount) || lessonCount <= 0 || !Number.isInteger(priceFen) || priceFen < 0 || !Number.isInteger(validityMonths) || validityMonths <= 0) throw new Error("请完整填写有效套餐信息");
      let item = payload.id && data.coursePackages.find((row) => row.id === payload.id); if (payload.id && !item) throw new Error("套餐不存在"); const normalized = { name: String(payload.name).trim(), lessonCount, priceFen, validityMonths, description: String(payload.description || "").trim(), sortOrder: Number(payload.sortOrder || 0), status: payload.status === "INACTIVE" ? "INACTIVE" : "ACTIVE", updatedAt: stamp() }; if (item) Object.assign(item, normalized); else { item = { id: uid("pkg"), packageCode: `CUSTOM_${Date.now()}`, ...normalized, createdAt: stamp() }; data.coursePackages.push(item); } audit(data, role, "SAVE_COURSE_PACKAGE", "coursePackage", item.id, normalized); save(data); return { ok: true, id: item.id };
    }
    case "setCoursePackageStatus": { assertRole(role, ["admin"]); const item = data.coursePackages.find((row) => row.id === input.id); if (!item) throw new Error("套餐不存在"); item.status = input.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"; item.updatedAt = stamp(); audit(data, role, "SET_COURSE_PACKAGE_STATUS", "coursePackage", item.id, { status: item.status }); save(data); return { ok: true }; }
    case "createOrder": {
      assertRole(role, ["admin", "parent"]); const studentId = input.studentId || ownStudentId; if (!canAccessStudent(data, role, studentId, userId)) throw new Error("无权为该学员购买套餐"); const item = data.coursePackages.find((row) => row.id === input.packageId && row.status === "ACTIVE"); if (!item) throw new Error("套餐不存在或已停止销售"); const packageSnapshot = { packageId: item.id, packageName: item.name, lessonCount: Number(item.lessonCount), priceFen: Number(item.priceFen), validityMonthsSnapshot: Number(item.validityMonths), applicableClassTypes: item.applicableClassTypes || [] }; const order = { id: uid("ord"), orderNo: `NL${Date.now()}`, userId, studentId, orderType: "LESSON_PACKAGE", packageId: item.id, packageSnapshot, lessons: packageSnapshot.lessonCount, payableAmount: packageSnapshot.priceFen, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", createdAt: stamp(), updatedAt: stamp() }; data.orders.unshift(order); audit(data, role, "CREATE_PACKAGE_ORDER", "order", order.id, { studentId, packageSnapshot }); save(data); return { id: order.id, orderNo: order.orderNo, payableAmount: order.payableAmount, amountYuan: (order.payableAmount / 100).toFixed(2), paymentConfigured: false };
    }
    case "listOrders": { if (role === "coach") return []; const studentIds = visibleStudents(data, role, userId).map((item) => item.id); return data.orders.filter((item) => role === "admin" || studentIds.includes(item.studentId)).map((item) => ({ ...item, studentName: (data.students.find((row) => row.id === item.studentId) || {}).name || "", displayName: (item.packageSnapshot || {}).packageName || item.courseTypeName || "课时套餐", lessonCount: Number((item.packageSnapshot || {}).lessonCount || item.lessons || 0), validityMonthsSnapshot: Number((item.packageSnapshot || {}).validityMonthsSnapshot || 0), amountYuan: (Number(item.payableAmount || 0) / 100).toFixed(2) })); }
    case "confirmOrderPayment": {
      assertRole(role, ["admin"]); const order = data.orders.find((item) => item.id === input.id); if (!order) throw new Error("订单不存在"); if (order.status === "PAID") return { ok: true, idempotent: true }; if (order.status !== "PENDING_PAYMENT") throw new Error("订单状态无法确认"); const snapshot = order.packageSnapshot || {}; const entitlement = { id: uid("lent"), studentId: order.studentId, orderId: order.id, packageIdSnapshot: snapshot.packageId || order.packageId, packageNameSnapshot: snapshot.packageName || "课时套餐", lessonCountSnapshot: Number(snapshot.lessonCount || order.lessons || 0), priceFenSnapshot: Number(snapshot.priceFen || order.payableAmount || 0), validityMonthsSnapshot: Number(snapshot.validityMonthsSnapshot || 0), totalLessons: Number(snapshot.lessonCount || order.lessons || 0), remainingLessons: Number(snapshot.lessonCount || order.lessons || 0), status: "UNACTIVATED", activatedAt: "", expiresAt: "", extensionDays: 0, createdAt: stamp(), updatedAt: stamp() }; order.status = "PAID"; order.paymentStatus = "PAID"; order.paymentMethod = input.paymentMethod || "MANUAL"; order.paidAt = stamp(); order.entitlementId = entitlement.id; order.updatedAt = stamp(); data.lessonEntitlements.push(entitlement); data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: entitlement.id, studentId: order.studentId, eventType: "PURCHASE", lessons: entitlement.totalLessons, orderId: order.id, validityMonthsSnapshot: entitlement.validityMonthsSnapshot, createdAt: stamp() }); const student = data.students.find((item) => item.id === order.studentId); student.totalLessons = Number(student.totalLessons || 0) + entitlement.totalLessons; appendLedger(data, order.studentId, entitlement.totalLessons, "purchase", "order", order.id, `${entitlement.packageNameSnapshot}到账，首次正式消课后激活`).entitlementId = entitlement.id; audit(data, role, "CONFIRM_ORDER_PAYMENT", "order", order.id, { entitlementId: entitlement.id, paymentMethod: order.paymentMethod }); save(data); return { ok: true, idempotent: false };
    }
    case "listLessonEntitlements": { if (role === "coach") throw new Error("教练无课时权益财务权限"); const studentId = input.studentId || ownStudentId; if (!canAccessStudent(data, role, studentId, userId)) throw new Error("无权查看该学员课时权益"); expireEntitlements(data, studentId); save(data); return data.lessonEntitlements.filter((item) => item.studentId === studentId).map(entitlementView); }
    case "extendLessonEntitlement": {
      assertRole(role, ["admin"]); const item = data.lessonEntitlements.find((row) => row.id === (input.entitlementId || input.id)); const extensionDays = Number(input.extensionDays); const reason = String(input.reason || "").trim(); if (!item) throw new Error("课时权益不存在"); if (!Number.isInteger(extensionDays) || extensionDays <= 0 || !reason) throw new Error("请填写延期天数和原因"); const oldExpiresAt = item.expiresAt || ""; item.extensionDays = Number(item.extensionDays || 0) + extensionDays; if (item.status === "UNACTIVATED") item.expiresAt = ""; else { item.expiresAt = addDays(item.expiresAt || today(), extensionDays); if (item.status === "EXPIRED" && Number(item.remainingLessons || 0) > 0) { item.status = "ACTIVE"; const student = data.students.find((row) => row.id === item.studentId); student.remainingLessons += Number(item.remainingLessons || 0); } } item.updatedAt = stamp(); const adjustment = { id: uid("lea"), entitlementId: item.id, studentId: item.studentId, adjustmentType: "ADMIN_EXTENSION", oldExpiresAt, extensionDays, newExpiresAt: item.expiresAt || "", reason, operatorId: userId, createdAt: stamp() }; data.lessonEntitlementAdjustments.unshift(adjustment); data.lessonEntitlementEvents.unshift({ id: uid("lee"), entitlementId: item.id, studentId: item.studentId, eventType: "EXTEND_VALIDITY", extensionDays, reason, createdAt: stamp() }); audit(data, role, "EXTEND_LESSON_ENTITLEMENT", "lessonEntitlement", item.id, adjustment); save(data); return { ok: true, entitlement: entitlementView(item) };
    }
    case "adjustStudentLessons": { assertRole(role, ["admin"]); const delta = Number(input.delta), reason = String(input.reason || "").trim(); if (!Number.isInteger(delta) || !delta || !reason) throw new Error("请填写课时调整数量和原因"); const student = data.students.find((item) => item.id === input.studentId); if (!student) throw new Error("学员不存在"); appendLedger(data, student.id, delta, "admin_adjustment", "student", student.id, reason); audit(data, role, "ADJUST_STUDENT_LESSONS", "student", student.id, { delta, reason }); save(data); return { ok: true }; }
    case "getPaymentReadiness": { assertRole(role, ["admin"]); return { configured: false, missing: ["微信支付商户配置"] }; }
    case "listFeedback": { const ids = visibleStudents(data, role, userId).map((item) => item.id); return data.feedback.filter((item) => (role !== "parent" || item.visibility !== "STAFF_ONLY") && (!input.studentId ? ids.includes(item.studentId) : item.studentId === input.studentId && ids.includes(item.studentId))).map((item) => ({ ...item, student: data.students.find((s) => s.id === item.studentId), session: data.sessions.find((s) => s.id === item.sessionId) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    case "saveFeedback": {
      assertRole(role, ["admin", "coach"]); const session = data.sessions.find((item) => item.id === input.sessionId);
      if (!session) throw new Error("课程不存在"); if (role === "coach" && !roleClassIds(data, role, userId).includes(session.classId)) throw new Error("无权反馈该课程");
      if (role === "coach" && !sessionMemberIds(data, session).includes(input.studentId)) throw new Error("该学员不是本班正式成员");
      const item = { id: uid("f"), sessionId: input.sessionId, studentId: input.studentId, coachName: role === "coach" ? "游导" : "南联教练组", rating: Number(input.rating || 4), tags: input.tags || [], content: String(input.content || ""), createdAt: stamp() }; if (!item.content) throw new Error("请填写训练反馈"); data.feedback.unshift(item); audit(data, role, "saveFeedback", "student", item.studentId, item.content.slice(0, 30)); save(data); return { ok: true };
    }
    case "listRenewals": { const ids = visibleStudents(data, role, userId).map((item) => item.id); if (role === "coach") return []; if (role === "parent" && input.studentId && !ids.includes(input.studentId)) throw new Error("无权访问该学员"); return data.renewals.filter((item) => role === "admin" || ids.includes(item.studentId) && (!input.studentId || item.studentId === input.studentId)).map((item) => ({ ...item, studentName: (data.students.find((s) => s.id === item.studentId) || {}).name || "" })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    case "createRenewal": { assertRole(role, ["admin", "parent"]); const studentId = input.studentId || ownStudentId; if (!canAccessStudent(data, role, studentId, userId)) throw new Error("无权续费"); const pack = PACKAGES[input.packageId]; if (!pack) throw new Error("续费套餐无效"); data.renewals.push({ id: uid("r"), studentId, packageId: input.packageId, ...pack, status: "pending", createdAt: stamp() }); save(data); return { ok: true }; }
    case "confirmRenewal": { assertRole(role, ["admin"]); const renewal = data.renewals.find((item) => item.id === input.id); if (!renewal || renewal.status !== "pending") throw new Error("订单状态已变化"); renewal.status = "paid"; renewal.paidAt = stamp(); const student = data.students.find((item) => item.id === renewal.studentId); student.totalLessons += renewal.lessons; appendLedger(data, renewal.studentId, renewal.lessons, "purchase", "renewal", renewal.id, `${renewal.name || "课包"}到账`); audit(data, role, "confirmRenewal", "renewal", renewal.id, `${renewal.amount}元`); save(data); return { ok: true }; }
    case "createInvite": assertRole(role, ["admin"]); return { code: "演示模式" };
    case "claimInvite": return { ok: true };
    case "resetDemo": { const demo = seed(); crm.ensure(demo, today()); training.ensure(demo); wx.setStorageSync(STORAGE_KEY, demo); return { ok: true }; }
    default: throw new Error(`暂不支持操作：${action}`);
  }
}

module.exports = { call, PACKAGES, DEDUCTION };
