const assert = require("assert");
const fs = require("fs");
const path = require("path");
const policy = require("../cloudfunctions/clubApi/auth-policy");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const cloud = read("cloudfunctions/clubApi/v2.js");
const authJs = read("miniprogram/pages/auth/index.js");
const authWxml = read("miniprogram/pages/auth/index.wxml");
const homeWxml = read("miniprogram/pages/index/index.wxml");
const profileJs = read("miniprogram/pages/profile/index.js");
const childJs = read("miniprogram/pages/parent-child-form/index.js");
const apiJs = read("miniprogram/utils/api.js");
const storage = {};
global.wx = { getStorageSync: (key) => storage[key], setStorageSync: (key, value) => { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");

let checks = 0;
const check = (value, message) => { assert(value, message); checks += 1; };

check(policy.accountState(null) === "UNREGISTERED", "new openid must be UNREGISTERED");
check(app.pages[0] === "pages/auth/index" && authWxml.includes("欢迎使用南联青训管理系统"), "new user starts on welcome page");
check(cloud.includes('event.action === "registerParent"') && cloud.includes('role: "parent"'), "parent self registration is explicit");
check(!/const role = BOOTSTRAP_ADMIN_OPENIDS\.includes\(openid\) \? "admin" : "parent"/.test(cloud), "unknown openid is never defaulted to parent");
check(authJs.includes('wx.switchTab({ url: "/pages/index/index" })'), "registered account enters its role-aware home");
check(homeWxml.includes("您还没有添加孩子信息") && homeWxml.includes("＋ 添加孩子"), "empty parent sees normal add-child state");
check(childJs.includes('api.call("submitChildProfile"') && !childJs.includes('api.call("registerMember"'), "first child reuses reviewed child-profile flow");
check(read("miniprogram/pages/students/index.js").includes('this.data.role === "parent" ? "/pages/parent-child-form/index"'), "parent can add another child through the same flow");
check(policy.accountState({ role: "parent", status: "ACTIVE" }) === "ACTIVE", "existing parent is recognized");
check(policy.accountState({ role: "coach", status: "ACTIVE" }) === "ACTIVE", "existing coach is recognized");
check(policy.accountState({ role: "admin", status: "ACTIVE" }) === "ACTIVE", "existing admin is recognized");
check(!cloud.includes("registerCoach") && !authWxml.includes("注册教练账号"), "coach has no public registration");
check(!cloud.includes("registerAdmin") && !authWxml.includes("注册管理员"), "admin has no public registration");
check(cloud.includes("assertActiveUser(user)") && cloud.includes("requireRole(user, roles)"), "frontend role changes cannot bypass cloud authorization");
check(cloud.includes('event.action === "staffLogin"') && cloud.includes('["coach", "admin"].includes(user.role)') && authJs.includes("暂未找到您的工作人员账号"), "unauthorized staff is rejected");
check(policy.accountState({ role: "parent", status: "DISABLED" }) === "DISABLED" && policy.accountState({ role: "coach", active: false }) === "DISABLED" && policy.accountState({ role: "parent", status: "PENDING" }) === "DISABLED", "non-ACTIVE account cannot enter business pages");
check(profileJs.includes("api.logout()") && apiJs.includes('wx.removeStorageSync("authUser")') && apiJs.includes('wx.removeStorageSync("activeStudentId")') && !apiJs.includes("deleteUser"), "logout only clears local session state");
check(authWxml.includes("手机号授权已取消") || authJs.includes("手机号授权已取消"), "phone authorization cancellation has a specific fallback");
check(cloud.includes("isLegacyPlaceholder") && cloud.includes('user.name === "待绑定家长"') && !cloud.includes('name: role === "admin" ? "南联管理员" : "待绑定家长"'), "legacy placeholder is no longer treated as a registered parent");
check(apiJs.includes('"UNREGISTERED", "ACCOUNT_DISABLED"') && authJs.includes("微信登录失败"), "authentication and network failures are handled separately");
check(cloud.includes('error.code || "SERVICE_ERROR"'), "cloud returns machine-readable authentication errors");
check(cloud.includes('if (existing.role !== "parent")') && cloud.includes("不能注册为家长"), "existing staff account cannot self-register as parent");

function idCard(prefix17) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const chars = "10X98765432";
  return `${prefix17}${chars[weights.reduce((sum, weight, index) => sum + Number(prefix17[index]) * weight, 0) % 11]}`;
}

(async () => {
  await domain.call("resetDemo", { previewRole: "admin" });
  const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent2" });
  const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
  const profile = (name, birthDate, prefix17) => ({ avatarUrl: `cloud://auth-test/${name}.jpg`, name, gender: "男", birthDate, idCardNumber: idCard(prefix17), school: "永嘉三幼", grade: "大班" });
  const first = await parent("submitChildProfile", { profile: profile("认证孩子甲", "2020-01-01", "33032720200101001") });
  await admin("reviewChildProfileRequest", { id: first.id, decision: "APPROVE" });
  check((await parent("getFamilyContext")).students.some((item) => item.name === "认证孩子甲"), "parent can add first child");
  const second = await parent("submitChildProfile", { profile: profile("认证孩子乙", "2020-02-02", "33032720200202001") });
  await admin("reviewChildProfileRequest", { id: second.id, decision: "APPROVE" });
  const family = await parent("getFamilyContext");
  check(family.students.some((item) => item.name === "认证孩子乙"), "parent can add second child");
  check(family.students.filter((item) => item.name.startsWith("认证孩子")).length === 2, "one parent owns both newly added children");
  console.log(`Authentication regression: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
