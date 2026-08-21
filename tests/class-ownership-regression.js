const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; }
};

const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const coach = (action, data = {}) => domain.call(action, { ...data, previewRole: "coach" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent" });

async function rejects(fn, pattern) {
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  assert(error, "expected action to reject");
  if (pattern) assert(pattern.test(error.message), `unexpected error: ${error.message}`);
}

function payload(overrides = {}) {
  return {
    name: "测试班级",
    classType: "REGULAR",
    ageGroup: "U9",
    standardCapacity: 16,
    assistantCoachName: "",
    schedule: "周六 09:00",
    venue: "测试球场",
    status: "ACTIVE",
    remark: "",
    ...overrides
  };
}

async function run() {
  let checks = 0;
  await admin("resetDemo");

  const elite = await coach("saveClass", { clubClass: payload({ name: "教练自建精英班", classType: "ELITE", scheduleSlots: [{ weekday: "周二", startTime: "18:30", endTime: "20:00" }, { weekday: "周六", startTime: "09:00", endTime: "10:30" }] }) });
  const eliteClass = await coach("getClass", { id: elite.id });
  assert.strictEqual(eliteClass.classType, "ELITE");
  assert.strictEqual(eliteClass.headCoachUserId, "coach1");
  assert((storage.nanlianClubV2.users.find((item) => item.id === "coach1").classIds || []).includes(elite.id));
  assert.strictEqual(eliteClass.schedule, "周二 18:30-20:00 / 周六 09:00-10:30");
  assert.strictEqual(eliteClass.scheduleSlots.length, 2);
  checks += 5;

  storage.nanlianClubV2.users.push({ id: "coach2", role: "coach", name: "王教练", classIds: [], studentIds: [] });
  const coaches = await admin("listClassCoaches");
  assert(coaches.some((item) => item.id === "coach2"));
  checks += 1;

  const regular = await admin("saveClass", { clubClass: payload({ name: "管理员创建普通班", headCoachUserId: "coach2" }) });
  const regularClass = await admin("getClass", { id: regular.id });
  assert.strictEqual(regularClass.headCoachUserId, "coach2");
  assert.strictEqual(regularClass.headCoachName, "王教练");
  assert(storage.nanlianClubV2.users.find((item) => item.id === "coach2").classIds.includes(regular.id));
  checks += 3;

  await rejects(() => coach("getClass", { id: regular.id }), /无权/);
  await rejects(() => coach("saveClass", { clubClass: payload({ id: regular.id, name: "越权编辑" }) }), /无权/);
  await rejects(() => parent("saveClass", { clubClass: payload() }), /权限/);
  checks += 3;

  await admin("saveClass", { clubClass: payload({ id: regular.id, name: "重新分配班级", headCoachUserId: "coach1" }) });
  assert(storage.nanlianClubV2.users.find((item) => item.id === "coach1").classIds.includes(regular.id));
  assert(!storage.nanlianClubV2.users.find((item) => item.id === "coach2").classIds.includes(regular.id));
  checks += 2;

  assert.strictEqual(checks, 14);
  console.log("Class ownership regression: 14 checks passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
