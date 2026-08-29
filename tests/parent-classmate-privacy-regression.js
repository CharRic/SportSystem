const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storage = {};
global.wx = { getStorageSync(key) { return storage[key]; }, setStorageSync(key, value) { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent1" });
async function rejects(fn, pattern) { let error; try { await fn(); } catch (caught) { error = caught; } assert(error, "expected rejection"); if (pattern) assert(pattern.test(error.message), error.message); }

async function run() {
  let checks = 0;
  await admin("resetDemo");
  const adminDetail = await admin("getClassDetail", { id: "c1718" });
  const detail = await parent("getParentClassDetail", { id: "c1718" });
  const allowedKeys = ["avatarUrl", "displayName", "studentId"];
  assert(detail.classmates.every((item) => Object.keys(item).sort().join("|") === allowedKeys.sort().join("|"))); checks += 1;
  assert(!JSON.stringify(detail.classmates).match(/guardian|phone|birthDate|school|remainingLessons|idCard|attendance|assessment|growth|crm/i)); checks += 1;

  await rejects(() => parent("getStudent", { id: "s2" }), /无权/); checks += 1;
  await rejects(() => parent("getGrowthProfile", { studentId: "s2" }), /无权/); checks += 1;
  await rejects(() => parent("getStudentPrivateProfile", { studentId: "s2" }), /管理员/); checks += 1;
  await rejects(() => parent("getParentClassDetail", { id: "c1516" }), /无权/); checks += 1;
  assert((await parent("getStudent", { id: "s1" })).id === "s1"); checks += 1;

  const beforeLeave = detail.studentCount;
  const leave = await parent("requestLeave", { sessionId: "se1", studentId: "s1", reason: "家庭安排" });
  await admin("reviewLeave", { id: leave.id, approved: true });
  assert((await parent("getParentClassDetail", { id: "c1718" })).studentCount === beforeLeave); checks += 1;

  const other = adminDetail.members.find((item) => item.student.id === "s2");
  await admin("removeClassMember", { memberId: other.id, reason: "转会/离队" });
  assert((await parent("getParentClassDetail", { id: "c1718" })).studentCount === beforeLeave - 1); checks += 1;

  const root = path.resolve(__dirname, "..");
  const page = fs.readFileSync(path.join(root, "miniprogram/pages/class-detail/index.js"), "utf8");
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/class-detail/index.wxml"), "utf8");
  const cloud = fs.readFileSync(path.join(root, "cloudfunctions/clubApi/class-service.js"), "utf8");
  assert(page.includes('value === true || value === "true"') && template.includes("data-mine") && template.includes("同班同学")); checks += 1;
  assert(cloud.includes("getParentClassDetail") && cloud.includes("无权查看该班级成员名单") && cloud.includes("displayName")); checks += 1;
  console.log(`Parent classmate privacy regression: ${checks} checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
