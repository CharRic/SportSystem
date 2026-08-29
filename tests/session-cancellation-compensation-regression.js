const assert = require("assert");
const storage = {};
global.wx = { getStorageSync: (key) => storage[key], setStorageSync: (key, value) => { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");

let checks = 0;
const check = (value, message) => { assert(value, message); checks += 1; };

(async () => {
  await domain.call("resetDemo", { previewRole: "admin" });
  const admin = (action, input = {}) => domain.call(action, { ...input, previewRole: "admin" });
  const parent = (action, input = {}) => domain.call(action, { ...input, previewRole: "parent", previewUserId: "parent1" });
  for (const studentId of ["s1", "s2"]) { const order = await admin("createOrder", { studentId, packageId: "pkg14" }); await admin("confirmOrderPayment", { id: order.id, paymentMethod: "MANUAL" }); }
  const result = await admin("cancelSession", { sessionId: "se1", reasonCode: "WEATHER", compensationType: "EXTEND_VALIDITY", extensionDays: 7 });
  check(result.affectedCount === 2 && result.adjustmentCount === 2, "only active class members are compensated");
  const data = storage.nanlianClubV2;
  check(data.sessions.find((item) => item.id === "se1").status === "CANCELLED", "original session is cancelled");
  check(data.sessionCancellationCompensations[0].affectedStudentIds.sort().join(",") === "s1,s2", "affected member snapshot is stored");
  check(data.lessonEntitlements.filter((item) => ["s1", "s2"].includes(item.studentId)).every((item) => item.status === "UNACTIVATED" && item.extensionDays === 7 && !item.expiresAt), "unactivated packages store extension credit");
  check(data.lessonLedger.filter((item) => item.referenceId === "se1" && item.type === "validity_extension").every((item) => item.note.includes("本次未扣课") && item.note.includes("顺延7天")), "parent ledger contains clear cancellation message");
  const beforeCancelledAttendance = data.lessonEntitlements.find((item) => item.studentId === "s1").remainingLessons;
  await assert.rejects(() => admin("submitAttendance", { sessionId: "se1", records: [{ studentId: "s1", status: "present" }] }), /已取消课程/, "cancelled session cannot deduct lessons"); checks += 1;
  check(data.lessonEntitlements.find((item) => item.studentId === "s1").remainingLessons === beforeCancelledAttendance, "cancelled session keeps lesson balance unchanged");
  const adjustmentCount = data.lessonEntitlementAdjustments.length;
  const repeated = await admin("cancelSession", { sessionId: "se1", reasonCode: "WEATHER", compensationType: "EXTEND_VALIDITY", extensionDays: 7 });
  check(repeated.idempotent === true && storage.nanlianClubV2.lessonEntitlementAdjustments.length === adjustmentCount, "same cancelled session cannot compensate twice");
  storage.nanlianClubV2.sessions.push({ id: "se-activate-credit", classId: "c1718", title: "补偿激活验证课", date: "2026-09-10", weekday: "周四", time: "15:00-17:00", venue: "三江南联球场", coachName: "游导", status: "published" });
  await admin("submitAttendance", { sessionId: "se-activate-credit", records: [{ studentId: "s1", status: "present" }] });
  const activated = storage.nanlianClubV2.lessonEntitlements.find((item) => item.studentId === "s1");
  check(activated.activatedAt === "2026-09-10" && activated.expiresAt === "2027-02-17", "activation applies validity months plus accumulated seven days");
  storage.nanlianClubV2.sessions.push({ id: "se-cancel-makeup", classId: "c1718", title: "原训练课", date: "2026-09-12", weekday: "周六", time: "15:00-17:00", venue: "三江南联球场", coachName: "游导", status: "published" });
  storage.nanlianClubV2.sessions.push({ id: "se-makeup", classId: "c1718", title: "补课", date: "2026-09-13", weekday: "周日", time: "15:00-17:00", venue: "三江南联球场", coachName: "游导", status: "published" });
  const beforeDays = activated.extensionDays;
  await admin("cancelSession", { sessionId: "se-cancel-makeup", reasonCode: "CLUB", compensationType: "MAKEUP_SESSION", replacementSessionId: "se-makeup" });
  check(storage.nanlianClubV2.lessonEntitlements.find((item) => item.id === activated.id).extensionDays === beforeDays, "makeup session does not also extend validity");
  check(storage.nanlianClubV2.sessions.find((item) => item.id === "se-cancel-makeup").replacementSessionId === "se-makeup" && storage.nanlianClubV2.sessions.find((item) => item.id === "se-makeup").makeupForSessionId === "se-cancel-makeup", "makeup relationship is bidirectional");
  const parentSession = await parent("getSession", { id: "se-cancel-makeup", studentId: "s1" });
  check(parentSession.status === "CANCELLED" && parentSession.makeupSession && parentSession.makeupSession.id === "se-makeup", "parent timetable exposes cancelled and replacement session");
  check(!Object.prototype.hasOwnProperty.call(parentSession, "affectedStudentIds") && !Object.prototype.hasOwnProperty.call(parentSession, "cancelReason"), "parent session response hides internal member snapshot and raw reason");
  await assert.rejects(() => parent("cancelSession", { sessionId: "se-makeup", reasonCode: "WEATHER" }), /权限/, "parent cannot cancel or modify compensation"); checks += 1;
  console.log(`Session cancellation compensation regression: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
