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
  const family = await parent("listStudents"); const first = family.find((item) => item.id === "s-family2"), second = family.find((item) => item.id === "s-family3");
  check(Boolean(first && second), "one parent can select multiple children");
  const classIdsBefore = (await parent("getStudent", { id: first.id })).classes.map((item) => item.id).sort().join(",");
  const firstOrder = await parent("createOrder", { studentId: first.id, packageId: "pkg14" });
  const secondOrder = await parent("createOrder", { studentId: second.id, packageId: "pkg28" });
  check(firstOrder.id !== secondOrder.id, "orders are isolated per child");
  await admin("saveCoursePackage", { item: { id: "pkg14", name: "14节训练套餐", lessonCount: 14, priceYuan: 1380, validityMonths: 6, sortOrder: 10 } });
  const pending = (await parent("listOrders")).find((item) => item.id === firstOrder.id);
  check(pending.validityMonthsSnapshot === 5, "order preserves purchase-time validity snapshot");
  check(pending.lessonCount === 14 && pending.amountYuan === "1380.00", "order preserves lesson and price snapshot");
  await admin("confirmOrderPayment", { id: firstOrder.id, paymentMethod: "MANUAL" });
  const again = await admin("confirmOrderPayment", { id: firstOrder.id, paymentMethod: "MANUAL" });
  check(again.idempotent === true, "payment settlement is idempotent");
  const detail = await parent("getStudent", { id: first.id });
  check(detail.lessonEntitlements.length === 1 && detail.lessonEntitlements[0].status === "UNACTIVATED", "payment creates one unactivated entitlement");
  check(detail.lessonEntitlements[0].validityMonthsSnapshot === 5, "entitlement copies order validity snapshot");
  check(detail.classes.map((item) => item.id).sort().join(",") === classIdsBefore, "buying a package does not create or change class membership");
  check((await parent("listOrders")).filter((item) => item.studentId === second.id).length === 1, "second child order remains separate");
  check((await coach("listOrders")).length === 0, "coach cannot read financial orders");
  console.log(`Order snapshot regression: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
