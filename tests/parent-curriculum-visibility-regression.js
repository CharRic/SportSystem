const assert = require("assert");

const storage = {};
global.wx = { getStorageSync(key) { return storage[key]; }, setStorageSync(key, value) { storage[key] = value; } };
const domain = require("../miniprogram/utils/local-domain");
const admin = (action, data = {}) => domain.call(action, { ...data, previewRole: "admin" });
const parent = (action, data = {}) => domain.call(action, { ...data, previewRole: "parent", previewUserId: "parent1" });

async function run() {
  let checks = 0;
  await admin("resetDemo");
  const regular = await parent("getParentClassTrainingOverview", { classId: "cu7base" });
  assert(regular.ageStage === "U7-U8" && regular.curriculum && regular.curriculum.name === "南联U7-U8训练大纲"); checks += 1;
  assert(regular.curriculum.parentGoals.includes("建立控球基础") && regular.curriculum.parentTrainingAreas.includes("传球")); checks += 1;
  assert(Object.keys(regular.curriculum).sort().join("|") === ["curriculumId", "name", "parentGoals", "parentSummary", "parentTrainingAreas"].sort().join("|")); checks += 1;

  const source = storage.nanlianClubV2.curriculums.find((item) => item.id === regular.curriculum.curriculumId);
  await admin("saveCurriculum", { curriculum: { ...source, description: "管理员更新后的U7-U8家长公开培养说明", objectives: ["更新后的阶段目标"], trainingTopics: ["BALL_MASTERY", "PASSING"] } });
  const updated = await parent("getParentClassTrainingOverview", { classId: "cu7base" });
  assert(updated.curriculum.parentSummary === "管理员更新后的U7-U8家长公开培养说明" && updated.curriculum.parentGoals[0] === "更新后的阶段目标"); checks += 1;

  await admin("saveCurriculum", { curriculum: { name: "南联U7精英队专项大纲", ageGroup: "U7", classType: "ELITE", objectives: ["提升高强度比赛决策"], trainingTopics: ["ONE_V_ONE_ATTACK", "TRANSITION"], description: "面向U7精英队的公开培养方向", sortOrder: 5, active: true } });
  const elite = await parent("getParentClassTrainingOverview", { classId: "c1718" });
  assert(elite.curriculum.name === "南联U7精英队专项大纲" && elite.curriculum.parentTrainingAreas.includes("攻防转换")); checks += 1;
  assert(elite.curriculum.curriculumId !== updated.curriculum.curriculumId); checks += 1;
  assert(!JSON.stringify(elite).match(/meetingNote|trainingNote|internalNote|updatedBy|createdBy/i)); checks += 1;

  const younger = await parent("getParentClassTrainingOverview", { classId: "cinterest" });
  assert(younger.curriculum.name === "南联U5-U6训练大纲" && younger.curriculum.curriculumId !== updated.curriculum.curriculumId); checks += 1;
  console.log(`Parent curriculum visibility regression: ${checks} checks passed`);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
