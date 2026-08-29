const assert = require("assert");

const storage = {};
global.wx = { getStorageSync(key) { return storage[key]; }, setStorageSync(key, value) { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent1" });

async function run() {
  let checks = 0;
  await admin("resetDemo");
  await admin("getClassDetail", { id: "c1718" });
  storage.nanlianClubV2.sessions.push({ id: "se-parent-class-detail", classId: "c1718", title: "精英队未来训练", date: "2026-08-30", weekday: "周日", time: "18:00-19:30", venue: "三江南联球场", trainingTheme: "1V1突破", status: "published", publishStatus: "PUBLISHED", coachUserId: "coach1", coachName: "游导" });

  const detail = await parent("getParentClassDetail", { id: "c1718" });
  assert(detail.id === "c1718" && detail.name === "U7精英队" && detail.classTypeLabel === "精英队" && detail.ageGroup); checks += 1;
  assert(detail.schedule && detail.venue === "三江南联球场"); checks += 1;
  assert(detail.headCoach && detail.headCoach.name === "游导"); checks += 1;
  assert(detail.assistantCoaches.some((item) => item.name === "王蒋生")); checks += 1;
  const future = detail.upcomingSessions.find((item) => item.sessionId === "se-parent-class-detail");
  assert(future && future.time === "18:00-19:30" && future.venue === "三江南联球场" && future.trainingTheme === "1V1突破" && future.coach.name === "游导"); checks += 1;
  assert(detail.classmates.length === detail.studentCount && detail.classmates.some((item) => item.studentId === "s1")); checks += 1;

  const browseOnly = await parent("getClassDetail", { id: "c1516" });
  assert(browseOnly.canViewRoster === false && browseOnly.classmates.length === 0 && browseOnly.upcomingSessions.length === 0); checks += 1;
  console.log(`Parent class detail regression: ${checks} checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
