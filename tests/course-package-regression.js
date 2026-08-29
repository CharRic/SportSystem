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
  const coach = (action, input = {}) => domain.call(action, { ...input, previewRole: "coach", previewUserId: "coach1" });
  const defaults = await parent("listCoursePackages");
  check(defaults.length === 3, "three initial packages are available");
  check(defaults.some((item) => item.lessonCount === 14 && item.priceFen === 138000 && item.validityMonths === 5), "14 lesson package is correct");
  check(defaults.some((item) => item.lessonCount === 28 && item.priceFen === 198000 && item.validityMonths === 9), "28 lesson package is correct");
  check(defaults.some((item) => item.lessonCount === 40 && item.priceFen === 248000 && item.validityMonths === 12), "40 lesson package is correct");
  const created = await admin("saveCoursePackage", { item: { name: "测试套餐", lessonCount: 8, priceYuan: 880, validityMonths: 3, description: "测试", sortOrder: 5 } });
  check(Boolean(created.id), "admin can create a configurable package");
  check((await parent("listCoursePackages")).some((item) => item.id === created.id && item.validityMonths === 3), "parent sees active package validity");
  await admin("setCoursePackageStatus", { id: created.id, status: "INACTIVE" });
  check(!(await parent("listCoursePackages")).some((item) => item.id === created.id), "inactive package is hidden from parent");
  check((await admin("listCoursePackages")).some((item) => item.id === created.id && item.status === "INACTIVE"), "admin retains inactive package");
  await assert.rejects(() => coach("listCoursePackages"), /权限|套餐财务/, "coach cannot read package prices"); checks += 1;
  await assert.rejects(() => parent("saveCoursePackage", { item: { name: "越权", lessonCount: 1, priceYuan: 1, validityMonths: 1 } }), /权限/, "parent cannot manage packages"); checks += 1;
  console.log(`Course package regression: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
