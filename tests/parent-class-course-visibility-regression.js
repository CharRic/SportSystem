const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storage = {};
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; }
};

const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent1" });

async function run() {
  let checks = 0;
  await admin("resetDemo");
  await admin("getClassDetail", { id: "cinterest" });

  const student = storage.nanlianClubV2.students.find((item) => item.id === "s1");
  storage.nanlianClubV2.classMembers = storage.nanlianClubV2.classMembers.filter((item) => item.studentId !== student.id);
  student.classIds = [];
  storage.nanlianClubV2.classes.forEach((item) => { item.studentIds = (item.studentIds || []).filter((studentId) => studentId !== student.id); });
  let listed = (await parent("listStudents")).find((item) => item.id === student.id);
  assert.strictEqual(listed.classNames, ""); checks += 1;

  const joined = await parent("joinClass", { classId: "cinterest", studentId: student.id });
  assert.strictEqual(joined.status, "ACTIVE"); checks += 1;
  assert(storage.nanlianClubV2.classMembers.some((item) => item.studentId === student.id && item.classId === "cinterest" && item.status === "ACTIVE")); checks += 1;

  listed = (await parent("listStudents")).find((item) => item.id === student.id);
  assert(listed.classes.some((item) => item.id === "cinterest" && item.memberStatus === "ACTIVE")); checks += 1;

  await admin("addClassMember", { classId: "c1718", studentId: student.id, confirmCapacity: true });
  listed = (await parent("listStudents")).find((item) => item.id === student.id);
  assert.deepStrictEqual(new Set(listed.classes.map((item) => item.id)), new Set(["cinterest", "c1718"])); checks += 1;

  storage.nanlianClubV2.sessions = storage.nanlianClubV2.sessions.filter((item) => !["cinterest", "c1718"].includes(item.classId));
  assert.strictEqual((await parent("listSessions", { studentId: student.id })).length, 0); checks += 1;

  storage.nanlianClubV2.sessions.push({ id: "se-parent-visible", classId: "cinterest", title: "U6启蒙班训练", date: "2026-08-30", weekday: "周日", time: "18:00-19:30", venue: "瓯北中心小学", status: "published", publishStatus: "PUBLISHED" });
  storage.nanlianClubV2.sessions.push({ id: "se-other-class", classId: "cu8advanced", title: "其他孩子课程", date: "2026-08-30", weekday: "周日", time: "18:00-19:30", venue: "瓯北中心小学", status: "published", publishStatus: "PUBLISHED" });
  let sessions = await parent("listSessions", { studentId: student.id });
  assert(sessions.some((item) => item.id === "se-parent-visible" && item.myStatus === "booked")); checks += 1;
  assert(!sessions.some((item) => item.id === "se-other-class")); checks += 1;

  const leave = await parent("requestLeave", { sessionId: "se-parent-visible", studentId: student.id, reason: "家庭安排" });
  await admin("reviewLeave", { id: leave.id, approved: true });
  sessions = await parent("listSessions", { studentId: student.id });
  assert(sessions.some((item) => item.id === "se-parent-visible" && item.myStatus === "leave_approved")); checks += 1;
  assert(storage.nanlianClubV2.classMembers.some((item) => item.studentId === student.id && item.classId === "cinterest" && item.status === "ACTIVE")); checks += 1;

  const root = path.resolve(__dirname, "..");
  const coursePage = fs.readFileSync(path.join(root, "miniprogram/pages/sessions/index.wxml"), "utf8");
  const studentPage = fs.readFileSync(path.join(root, "miniprogram/pages/student-detail/index.wxml"), "utf8");
  const signupPage = fs.readFileSync(path.join(root, "miniprogram/pages/class-detail/index.js"), "utf8");
  assert(coursePage.includes("我的班级") && coursePage.includes("当前暂无新的训练安排")); checks += 1;
  assert(studentPage.includes("正式成员") && studentPage.includes("暂未加入班级")); checks += 1;
  assert(signupPage.includes("查看班级详情") && signupPage.includes("查看课表")); checks += 1;

  console.log(`Parent class/course visibility regression: ${checks} checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
