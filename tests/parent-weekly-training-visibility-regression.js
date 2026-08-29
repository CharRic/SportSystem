const assert = require("assert");

const storage = {};
global.wx = { getStorageSync(key) { return storage[key]; }, setStorageSync(key, value) { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent1" });

async function run() {
  let checks = 0;
  await admin("resetDemo");
  storage.nanlianClubV2.weeklyTrainingPlans.push(
    { id: "wp-parent-confirmed", classId: "c1718", coachId: "coach1", coachName: "游导", weekStart: "2026-08-24", weekEnd: "2026-08-30", mainTheme: "1V1进攻", trainingFocus: ["变向突破", "突破后加速", "突破后射门"], curriculumId: "cur-u8-elite-simple", status: "CONFIRMED", meetingNote: "周六会议内部调整，不得返回家长", updatedBy: "admin", updatedAt: "2026-08-27 10:00" },
    { id: "wp-parent-draft", classId: "c1718", coachId: "coach1", coachName: "游导", weekStart: "2026-08-24", weekEnd: "2026-08-30", mainTheme: "未发布内部草稿", trainingFocus: ["内部内容"], status: "DRAFT", meetingNote: "内部草稿备注", updatedAt: "2026-08-27 11:00" }
  );
  const overview = await parent("getParentClassTrainingOverview", { classId: "c1718" });
  assert(overview.weeklyPlan.mainTheme === "1V1进攻"); checks += 1;
  assert.deepStrictEqual(overview.weeklyPlan.trainingFocus, ["变向突破", "突破后加速", "突破后射门"]); checks += 1;
  assert(!JSON.stringify(overview).includes("meetingNote") && !JSON.stringify(overview).includes("周六会议内部调整") && !JSON.stringify(overview).includes("未发布内部草稿")); checks += 1;

  storage.nanlianClubV2.sessions.push({ id: "se-parent-latest", classId: "c1718", title: "U7精英队临时调整课", date: "2026-08-30", weekday: "周日", time: "19:00-20:30", venue: "临时调整后的球场", trainingTheme: "1V1突破", trainingFocus: "变向 / 加速 / 突破后射门", trainingNote: "教练内部训练纠错要求", status: "published", publishStatus: "PUBLISHED", coachUserId: "coach1", coachName: "游导", actualCoachAssignments: [{ coachId: "coach4", role: "HEAD" }] });
  const session = await parent("getSession", { id: "se-parent-latest", studentId: "s1" });
  assert(session.trainingTheme === "1V1突破" && session.trainingFocus === "变向 / 加速 / 突破后射门"); checks += 1;
  assert(session.venue === "临时调整后的球场" && session.coach.name === "吴教练"); checks += 1;
  assert(session.className === "U7精英队" && session.ageGroup.includes("U7")); checks += 1;
  assert(!Object.prototype.hasOwnProperty.call(session, "trainingNote") && !Object.prototype.hasOwnProperty.call(session, "weeklyTrainingPlanId")); checks += 1;

  const detail = await parent("getParentClassDetail", { id: "c1718" });
  const latest = detail.upcomingSessions.find((item) => item.sessionId === "se-parent-latest");
  assert(latest && latest.venue === "临时调整后的球场" && latest.coach.name === "吴教练"); checks += 1;
  const other = await parent("getParentClassTrainingOverview", { classId: "cinterest" });
  assert(!other.weeklyPlan || other.weeklyPlan.mainTheme !== overview.weeklyPlan.mainTheme); checks += 1;
  console.log(`Parent weekly training visibility regression: ${checks} checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
