const ACTIONS = new Set([
  "getTrainingMeta",
  "getResearchDashboard",
  "listCurriculums",
  "saveCurriculum",
  "setCurriculumStatus",
  "archiveCurriculum",
  "listWeeklyTrainingPlans",
  "getWeeklyTrainingPlan",
  "saveWeeklyTrainingPlan",
  "confirmWeeklyTrainingPlan",
  "saveSessionTrainingInfo",
  "getSessionTrainingInfo",
  "getSessionTrainingPlan",
  "getParentClassTrainingOverview",
]);

const TRAINING_TOPICS = {
  BALL_MASTERY: "球感", DRIBBLING: "带球", PASSING: "传球", RECEIVING: "接球",
  SHOOTING: "射门", ONE_V_ONE_ATTACK: "1V1进攻", ONE_V_ONE_DEFENSE: "1V1防守",
  TWO_V_ONE: "2V1", SPATIAL_AWARENESS: "空间意识", TRANSITION: "攻防转换",
  TEAM_PLAY: "团队配合", COORDINATION: "协调", MATCH_PLAY: "比赛",
};
const STATUS_LABELS = { DRAFT: "草稿", CONFIRMED: "已确认", COMPLETED: "已完成" };
const DEFAULT_CURRICULUMS = [
  { name: "南联U5-U6训练大纲", ageGroup: "U5-U6", classType: "REGULAR", objectives: ["建立足球兴趣", "发展球感与协调"], trainingTopics: ["BALL_MASTERY", "COORDINATION", "DRIBBLING", "SHOOTING", "ONE_V_ONE_ATTACK", "MATCH_PLAY"], description: "球感、协调、带球、射门、简单1V1和游戏化比赛。", sortOrder: 10 },
  { name: "南联U7-U8训练大纲", ageGroup: "U7-U8", classType: "REGULAR", objectives: ["建立控球基础", "培养主动进攻与空间意识"], trainingTopics: ["BALL_MASTERY", "DRIBBLING", "PASSING", "RECEIVING", "ONE_V_ONE_ATTACK", "TWO_V_ONE", "SHOOTING", "SPATIAL_AWARENESS", "TRANSITION", "MATCH_PLAY"], description: "控球、带球、传接球、1V1、2V1、射门、空间意识、攻防转换和小场比赛。", sortOrder: 20 },
  { name: "南联U8精英队训练大纲", ageGroup: "U8", classType: "ELITE", objectives: ["提高比赛决策", "发展团队配合与位置意识"], trainingTopics: ["ONE_V_ONE_ATTACK", "TRANSITION", "SPATIAL_AWARENESS", "TEAM_PLAY", "MATCH_PLAY"], description: "高强度1V1、攻防转换、比赛决策、团队配合、位置意识和比赛应用。", sortOrder: 30 },
];

function createTrainingService(deps) {
  const { db, fetchAll, publicDoc, nowText, requireRole, audit, assertStudentAccess } = deps;
  const focusList = (value) => (Array.isArray(value) ? value : String(value || "").split(/[、，,\n/]+/)).map((item) => String(item).trim()).filter(Boolean);
  const focusText = (value) => focusList(value).join(" / ");
  const canClass = (user, classId) => user.role === "admin" || user.role === "coach" && (user.classIds || []).includes(classId);
  const requireStaff = (user) => requireRole(user, ["admin", "coach"]);
  const ageNumbers = (value) => [...String(value || "").matchAll(/U\s*(\d{1,2})/gi)].map((match) => Number(match[1]));
  const ageMatches = (classAgeGroup, curriculumAgeGroup) => {
    const classAges = ageNumbers(classAgeGroup), curriculumAges = ageNumbers(curriculumAgeGroup);
    if (!classAges.length || !curriculumAges.length) return String(classAgeGroup || "").trim() === String(curriculumAgeGroup || "").trim();
    const low = Math.min(...curriculumAges), high = Math.max(...curriculumAges);
    return classAges.some((age) => age >= low && age <= high);
  };

  async function ensureDefaults() {
    const existing = await fetchAll("curriculums");
    if (existing.length) return;
    for (const item of DEFAULT_CURRICULUMS) {
      await db.collection("curriculums").add({ data: { ...item, active: true, createdBy: "SYSTEM", createdAt: nowText(), updatedAt: nowText() } });
    }
  }

  function curriculumView(item) {
    return { ...publicDoc(item), topicNames: (item.trainingTopics || []).map((key) => TRAINING_TOPICS[key] || key) };
  }

  async function planView(item, includeInternal = true) {
    const [classResult, curriculumResult] = await Promise.all([
      db.collection("classes").doc(item.classId).get().catch(() => ({ data: null })),
      item.curriculumId ? db.collection("curriculums").doc(item.curriculumId).get().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ]);
    const value = { ...publicDoc(item), className: (classResult.data || {}).name || "", ageGroup: (classResult.data || {}).ageGroup || "", curriculumName: (curriculumResult.data || {}).name || "", statusLabel: STATUS_LABELS[item.status] || item.status, trainingFocus: focusList(item.trainingFocus) };
    if (!includeInternal) delete value.meetingNote;
    return value;
  }

  async function listCurriculums(user) {
    requireStaff(user);
    let rows = await fetchAll("curriculums");
    if (user.role === "coach") rows = rows.filter((item) => item.active !== false);
    return rows.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name))).map(curriculumView);
  }

  async function saveCurriculum(user, raw) {
    requireRole(user, ["admin"]);
    const previous = raw.id ? (await db.collection("curriculums").doc(raw.id).get().catch(() => ({ data: null }))).data : null;
    const data = {
      name: String(raw.name || "").trim(), ageGroup: String(raw.ageGroup || "").trim(),
      classType: raw.classType === "ELITE" ? "ELITE" : "REGULAR",
      objectives: (raw.objectives || []).map((item) => String(item).trim()).filter(Boolean),
      trainingTopics: [...new Set(raw.trainingTopics || [])].filter((key) => TRAINING_TOPICS[key]),
      description: String(raw.description || "").trim(), sortOrder: Number(raw.sortOrder || 0),
      active: previous ? previous.active !== false : raw.active !== false, updatedAt: nowText(),
    };
    if (!data.name || !data.ageGroup || !data.trainingTopics.length) throw new Error("训练大纲信息不完整");
    let id = raw.id;
    if (id) await db.collection("curriculums").doc(id).update({ data });
    else { const added = await db.collection("curriculums").add({ data: { ...data, createdBy: user._id, createdAt: nowText() } }); id = added._id; }
    await audit(user, previous ? "UPDATE_CURRICULUM" : "CREATE_CURRICULUM", "curriculum", id, { name: data.name, sortOrder: data.sortOrder });
    return { id };
  }

  async function setCurriculumStatus(user, input) {
    requireRole(user, ["admin"]);
    const current = (await db.collection("curriculums").doc(input.id).get().catch(() => ({ data: null }))).data;
    if (!current) throw new Error("训练大纲不存在");
    const active = input.active !== false;
    await db.collection("curriculums").doc(input.id).update({ data: { active, updatedAt: nowText() } });
    await audit(user, active ? "RESTORE_CURRICULUM" : "ARCHIVE_CURRICULUM", "curriculum", input.id, { name: current.name });
    return { ok: true, active };
  }

  async function listWeeklyPlans(user, input) {
    requireStaff(user);
    let rows = await fetchAll("weeklyTrainingPlans");
    rows = rows.filter((item) => canClass(user, item.classId));
    if (input.classId) rows = rows.filter((item) => item.classId === input.classId);
    if (input.coachId) rows = rows.filter((item) => item.coachId === input.coachId);
    if (input.status) rows = rows.filter((item) => item.status === input.status);
    const result = [];
    for (const item of rows.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)))) result.push(await planView(item));
    return result;
  }

  async function getWeeklyPlan(user, id) {
    requireStaff(user);
    const item = (await db.collection("weeklyTrainingPlans").doc(id).get().catch(() => ({ data: null }))).data;
    if (!item || !canClass(user, item.classId)) throw new Error("无权查看该周训练计划");
    return planView(item);
  }

  async function saveWeeklyPlan(user, raw) {
    requireStaff(user);
    const previous = raw.id ? (await db.collection("weeklyTrainingPlans").doc(raw.id).get().catch(() => ({ data: null }))).data : null;
    if (previous && !canClass(user, previous.classId)) throw new Error("无权修改该周训练计划");
    const classId = String(raw.classId || (previous || {}).classId || "");
    if (!canClass(user, classId)) throw new Error("只能制定自己负责班级的周计划");
    const clubClass = (await db.collection("classes").doc(classId).get().catch(() => ({ data: null }))).data;
    if (!clubClass || clubClass.status === "INACTIVE") throw new Error("班级不存在或已停用");
    const weekStart = String(raw.weekStart || ""), weekEnd = String(raw.weekEnd || "");
    const trainingFocus = focusList(raw.trainingFocus);
    if (!weekStart || !weekEnd || weekStart > weekEnd || !String(raw.mainTheme || "").trim() || !trainingFocus.length) throw new Error("周训练计划信息不完整");
    const duplicate = (await fetchAll("weeklyTrainingPlans", { classId, weekStart })).find((item) => item._id !== raw.id && item.status !== "COMPLETED");
    if (duplicate) throw new Error("该班级本周已有训练计划");
    const data = {
      classId, coachId: user.role === "coach" ? user._id : String(raw.coachId || (previous || {}).coachId || clubClass.headCoachUserId || clubClass.coachUserId || ""),
      coachName: user.role === "coach" ? user.name : String(raw.coachName || (previous || {}).coachName || clubClass.headCoachName || clubClass.coachName || ""),
      weekStart, weekEnd, mainTheme: String(raw.mainTheme || "").trim(), themeKey: String(raw.themeKey || ""), trainingFocus,
      curriculumId: String(raw.curriculumId || ""), status: previous ? previous.status || "DRAFT" : "DRAFT",
      meetingNote: String(raw.meetingNote === undefined ? (previous || {}).meetingNote || "" : raw.meetingNote), updatedBy: user._id, updatedAt: nowText(),
    };
    let id = raw.id;
    if (id) await db.collection("weeklyTrainingPlans").doc(id).update({ data });
    else { const added = await db.collection("weeklyTrainingPlans").add({ data: { ...data, createdAt: nowText() } }); id = added._id; }
    await audit(user, previous ? "UPDATE_WEEKLY_TRAINING_PLAN" : "CREATE_WEEKLY_TRAINING_PLAN", "weeklyTrainingPlan", id, { classId, status: data.status });
    return { id };
  }

  async function confirmWeeklyPlan(user, input) {
    requireStaff(user);
    const item = (await db.collection("weeklyTrainingPlans").doc(input.id).get().catch(() => ({ data: null }))).data;
    if (!item || !canClass(user, item.classId)) throw new Error("无权确认该周训练计划");
    const status = input.completed ? "COMPLETED" : "CONFIRMED";
    const data = { status, updatedBy: user._id, updatedAt: nowText() };
    if (input.meetingNote !== undefined) data.meetingNote = String(input.meetingNote || "");
    await db.collection("weeklyTrainingPlans").doc(input.id).update({ data });
    await audit(user, "CONFIRM_WEEKLY_TRAINING_PLAN", "weeklyTrainingPlan", input.id, { classId: item.classId, status });
    return { ok: true, status };
  }

  async function saveSessionTraining(user, input) {
    requireStaff(user);
    const session = (await db.collection("sessions").doc(input.sessionId).get().catch(() => ({ data: null }))).data;
    if (!session || !canClass(user, session.classId)) throw new Error("无权修改该课程训练信息");
    const trainingTheme = String(input.trainingTheme || "").trim(), trainingFocus = focusText(input.trainingFocus);
    if (!trainingTheme || !trainingFocus) throw new Error("请填写训练主题和训练重点");
    const weeklyTrainingPlanId = String(input.weeklyTrainingPlanId || "");
    if (weeklyTrainingPlanId) {
      const plan = (await db.collection("weeklyTrainingPlans").doc(weeklyTrainingPlanId).get().catch(() => ({ data: null }))).data;
      if (!plan || plan.classId !== session.classId) throw new Error("周训练计划与课程班级不一致");
    }
    const data = { trainingTheme, trainingThemeKey: String(input.trainingThemeKey || ""), trainingFocus, focus: trainingFocus, trainingNote: String(input.trainingNote || ""), weeklyTrainingPlanId, updatedBy: user._id, updatedAt: nowText() };
    await db.collection("sessions").doc(input.sessionId).update({ data });
    await audit(user, "SAVE_SESSION_TRAINING_INFO", "session", input.sessionId, { classId: session.classId, trainingTheme });
    return { ok: true };
  }

  async function getSessionTraining(user, input) {
    const session = (await db.collection("sessions").doc(input.sessionId).get().catch(() => ({ data: null }))).data;
    if (!session) throw new Error("课程不存在");
    let weekly = null;
    if (session.weeklyTrainingPlanId) weekly = (await db.collection("weeklyTrainingPlans").doc(session.weeklyTrainingPlanId).get().catch(() => ({ data: null }))).data;
    const value = { session: { id: session._id, title: session.title, date: session.date, time: session.time, classId: session.classId }, trainingTheme: session.trainingTheme || "", trainingThemeKey: session.trainingThemeKey || "", trainingFocus: String(session.trainingFocus || session.focus || ""), weeklyTrainingPlanId: session.weeklyTrainingPlanId || "", weeklyTheme: weekly ? weekly.mainTheme : "" };
    if (user.role === "parent") {
      await assertStudentAccess(user, input.studentId);
      const membership = (await fetchAll("classMembers", { classId: session.classId, studentId: input.studentId, status: "ACTIVE" }))[0];
      if (!membership) throw new Error("该学员不是本课程班级成员");
      return value;
    }
    requireStaff(user);
    if (!canClass(user, session.classId)) throw new Error("无权查看该课程训练信息");
    return { ...value, trainingNote: session.trainingNote || "", weeklyPlan: weekly ? await planView(weekly) : null };
  }

  async function parentClassTrainingOverview(user, input) {
    requireRole(user, ["parent"]);
    await ensureDefaults();
    const classId = String(input.classId || "");
    const [clubClassResult, ownedStudents, memberships] = await Promise.all([
      db.collection("classes").doc(classId).get().catch(() => ({ data: null })),
      fetchAll("students", { ownerParentUserId: user._id, status: "active" }),
      fetchAll("classMembers", { classId, status: "ACTIVE" }),
    ]);
    const clubClass = clubClassResult.data;
    const ownedIds = new Set(ownedStudents.map((item) => item._id));
    if (!clubClass || !memberships.some((item) => ownedIds.has(item.studentId))) throw new Error("无权查看该班级培养内容");
    const today = nowText().slice(0, 10);
    const confirmedPlans = (await fetchAll("weeklyTrainingPlans", { classId })).filter((item) => item.status === "CONFIRMED" && item.weekStart <= today && item.weekEnd >= today).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const weekly = confirmedPlans[0] || null;
    const activeCurriculums = (await fetchAll("curriculums")).filter((item) => item.active !== false && (item.classType || "REGULAR") === (clubClass.classType || "REGULAR") && ageMatches(clubClass.ageGroup, item.ageGroup));
    let curriculum = weekly && weekly.curriculumId ? activeCurriculums.find((item) => item._id === weekly.curriculumId) : null;
    if (!curriculum) curriculum = activeCurriculums.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))[0] || null;
    return {
      classId,
      ageStage: curriculum ? curriculum.ageGroup : clubClass.ageGroup || "",
      curriculum: curriculum ? { curriculumId: curriculum._id, name: curriculum.name || "", parentSummary: curriculum.description || "", parentGoals: (curriculum.objectives || []).map(String), parentTrainingAreas: (curriculum.trainingTopics || []).map((key) => TRAINING_TOPICS[key] || key) } : null,
      weeklyPlan: weekly ? { weekStart: weekly.weekStart || "", weekEnd: weekly.weekEnd || "", mainTheme: weekly.mainTheme || "", trainingFocus: focusList(weekly.trainingFocus) } : null,
    };
  }

  async function dashboard(user) {
    requireStaff(user);
    const [curriculums, plans, sessions] = await Promise.all([fetchAll("curriculums"), fetchAll("weeklyTrainingPlans"), fetchAll("sessions")]);
    const visiblePlans = plans.filter((item) => canClass(user, item.classId));
    const visibleSessions = sessions.filter((item) => canClass(user, item.classId));
    const rows = [];
    for (const item of visiblePlans.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).slice(0, 20)) rows.push(await planView(item));
    return { metrics: { curriculums: curriculums.filter((item) => item.active !== false).length, weeklyPlans: visiblePlans.length, confirmedPlans: visiblePlans.filter((item) => item.status === "CONFIRMED").length, sessions: visibleSessions.length, filledSessions: visibleSessions.filter((item) => item.trainingTheme && String(item.trainingFocus || "").trim()).length }, weeklyPlans: rows };
  }

  async function call(action, input, user) {
    if (action === "getTrainingMeta") { requireStaff(user); return { trainingTopics: TRAINING_TOPICS, statuses: STATUS_LABELS }; }
    if (action === "getResearchDashboard") return dashboard(user);
    if (action === "listCurriculums") return listCurriculums(user);
    if (action === "saveCurriculum") return saveCurriculum(user, input.curriculum || {});
    if (action === "setCurriculumStatus") return setCurriculumStatus(user, input);
    if (action === "archiveCurriculum") return setCurriculumStatus(user, { ...input, active: false });
    if (action === "listWeeklyTrainingPlans") return listWeeklyPlans(user, input);
    if (action === "getWeeklyTrainingPlan") return getWeeklyPlan(user, input.id);
    if (action === "saveWeeklyTrainingPlan") return saveWeeklyPlan(user, input.plan || {});
    if (action === "confirmWeeklyTrainingPlan") return confirmWeeklyPlan(user, input);
    if (action === "saveSessionTrainingInfo") return saveSessionTraining(user, input);
    if (action === "getSessionTrainingInfo" || action === "getSessionTrainingPlan") return getSessionTraining(user, input);
    if (action === "getParentClassTrainingOverview") return parentClassTrainingOverview(user, input);
    throw new Error("未知训练管理操作");
  }

  return { handles: (action) => ACTIONS.has(action), ensureDefaults, call };
}

module.exports = { createTrainingService, TRAINING_TOPICS };
