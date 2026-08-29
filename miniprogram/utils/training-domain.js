const ACTIONS = new Set(["getTrainingMeta", "getResearchDashboard", "listCurriculums", "saveCurriculum", "setCurriculumStatus", "archiveCurriculum", "listWeeklyTrainingPlans", "getWeeklyTrainingPlan", "saveWeeklyTrainingPlan", "confirmWeeklyTrainingPlan", "saveSessionTrainingInfo", "getSessionTrainingInfo", "getSessionTrainingPlan", "getParentClassTrainingOverview"]);
const TRAINING_TOPICS = { BALL_MASTERY: "球感", DRIBBLING: "带球", PASSING: "传球", RECEIVING: "接球", SHOOTING: "射门", ONE_V_ONE_ATTACK: "1V1进攻", ONE_V_ONE_DEFENSE: "1V1防守", TWO_V_ONE: "2V1", SPATIAL_AWARENESS: "空间意识", TRANSITION: "攻防转换", TEAM_PLAY: "团队配合", COORDINATION: "协调", MATCH_PLAY: "比赛" };
const STATUS_LABELS = { DRAFT: "草稿", CONFIRMED: "已确认", COMPLETED: "已完成" };
const DEFAULTS = [
  { id: "cur-u6-simple", name: "南联U5-U6训练大纲", ageGroup: "U5-U6", classType: "REGULAR", objectives: ["建立足球兴趣", "发展球感与协调"], trainingTopics: ["BALL_MASTERY", "COORDINATION", "DRIBBLING", "SHOOTING", "ONE_V_ONE_ATTACK", "MATCH_PLAY"], description: "球感、协调、带球、射门、简单1V1和游戏化比赛。", sortOrder: 10 },
  { id: "cur-u8-simple", name: "南联U7-U8训练大纲", ageGroup: "U7-U8", classType: "REGULAR", objectives: ["建立控球基础", "培养主动进攻与空间意识"], trainingTopics: ["BALL_MASTERY", "DRIBBLING", "PASSING", "RECEIVING", "ONE_V_ONE_ATTACK", "TWO_V_ONE", "SHOOTING", "SPATIAL_AWARENESS", "TRANSITION", "MATCH_PLAY"], description: "控球、带球、传接球、1V1、2V1、射门、空间意识、攻防转换和小场比赛。", sortOrder: 20 },
  { id: "cur-u8-elite-simple", name: "南联U8精英队训练大纲", ageGroup: "U8", classType: "ELITE", objectives: ["提高比赛决策", "发展团队配合与位置意识"], trainingTopics: ["ONE_V_ONE_ATTACK", "TRANSITION", "SPATIAL_AWARENESS", "TEAM_PLAY", "MATCH_PLAY"], description: "高强度1V1、攻防转换、比赛决策、团队配合、位置意识和比赛应用。", sortOrder: 30 }
];
const focusList = (value) => (Array.isArray(value) ? value : String(value || "").split(/[、，,\n/]+/)).map((item) => String(item).trim()).filter(Boolean);
const focusText = (value) => focusList(value).join(" / ");
const ageNumbers = (value) => [...String(value || "").matchAll(/U\s*(\d{1,2})/gi)].map((match) => Number(match[1]));
function ageMatches(classAgeGroup, curriculumAgeGroup) { const classAges = ageNumbers(classAgeGroup), curriculumAges = ageNumbers(curriculumAgeGroup); if (!classAges.length || !curriculumAges.length) return String(classAgeGroup || "").trim() === String(curriculumAgeGroup || "").trim(); const low = Math.min(...curriculumAges), high = Math.max(...curriculumAges); return classAges.some((age) => age >= low && age <= high); }
function ensure(data) {
  data.curriculums = data.curriculums || [];
  if (!data.curriculums.length) data.curriculums.push(...DEFAULTS.map((item) => ({ ...item, active: true, createdBy: "SYSTEM", createdAt: "2026-08-25 09:00", updatedAt: "2026-08-25 09:00" })));
  data.weeklyTrainingPlans = data.weeklyTrainingPlans || [];
  (data.sessions || []).forEach((item) => { if (Array.isArray(item.trainingFocus)) item.trainingFocus = focusText(item.trainingFocus); });
}
function staff(ctx) { if (!["admin", "coach"].includes(ctx.role)) throw new Error("仅教练团队可进入训练管理"); }
function canClass(ctx, id) { return ctx.role === "admin" || ctx.canAccessClass(id); }
function curriculumView(item) { return { ...item, topicNames: (item.trainingTopics || []).map((key) => TRAINING_TOPICS[key] || key) }; }
function planView(data, item) { const clubClass = data.classes.find((row) => row.id === item.classId) || {}, curriculum = data.curriculums.find((row) => row.id === item.curriculumId) || {}; return { ...item, trainingFocus: focusList(item.trainingFocus), className: clubClass.name || "", ageGroup: clubClass.ageGroup || "", curriculumName: curriculum.name || "", statusLabel: STATUS_LABELS[item.status] || item.status }; }
function call(action, input, ctx) {
  const { data } = ctx; ensure(data);
  if (action === "getTrainingMeta") { staff(ctx); return { trainingTopics: TRAINING_TOPICS, statuses: STATUS_LABELS }; }
  if (action === "listCurriculums") { staff(ctx); return data.curriculums.filter((item) => ctx.role === "admin" || item.active !== false).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map(curriculumView); }
  if (action === "saveCurriculum") {
    if (ctx.role !== "admin") throw new Error("仅管理员可维护训练大纲");
    const raw = input.curriculum || {}, old = raw.id && data.curriculums.find((item) => item.id === raw.id);
    const item = { id: raw.id || ctx.uid("cur"), name: String(raw.name || "").trim(), ageGroup: String(raw.ageGroup || "").trim(), classType: raw.classType === "ELITE" ? "ELITE" : "REGULAR", objectives: (raw.objectives || []).map((value) => String(value).trim()).filter(Boolean), trainingTopics: [...new Set(raw.trainingTopics || [])].filter((key) => TRAINING_TOPICS[key]), description: String(raw.description || "").trim(), sortOrder: Number(raw.sortOrder || 0), active: old ? old.active !== false : raw.active !== false, createdBy: old ? old.createdBy : ctx.userId, createdAt: old ? old.createdAt : ctx.stamp(), updatedAt: ctx.stamp() };
    if (!item.name || !item.ageGroup || !item.trainingTopics.length) throw new Error("训练大纲信息不完整");
    if (old) Object.assign(old, item); else data.curriculums.push(item); ctx.audit(old ? "UPDATE_CURRICULUM" : "CREATE_CURRICULUM", "curriculum", item.id, { name: item.name, sortOrder: item.sortOrder }); ctx.save(); return { id: item.id };
  }
  if (action === "setCurriculumStatus" || action === "archiveCurriculum") {
    if (ctx.role !== "admin") throw new Error("仅管理员可维护训练大纲"); const item = data.curriculums.find((row) => row.id === input.id); if (!item) throw new Error("训练大纲不存在");
    item.active = action === "archiveCurriculum" ? false : input.active !== false; item.updatedAt = ctx.stamp(); ctx.audit(item.active ? "RESTORE_CURRICULUM" : "ARCHIVE_CURRICULUM", "curriculum", item.id, { name: item.name }); ctx.save(); return { ok: true, active: item.active };
  }
  if (action === "listWeeklyTrainingPlans") { staff(ctx); let rows = data.weeklyTrainingPlans.filter((item) => canClass(ctx, item.classId)); if (input.classId) rows = rows.filter((item) => item.classId === input.classId); if (input.coachId) rows = rows.filter((item) => item.coachId === input.coachId); if (input.status) rows = rows.filter((item) => item.status === input.status); return rows.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).map((item) => planView(data, item)); }
  if (action === "getWeeklyTrainingPlan") { staff(ctx); const item = data.weeklyTrainingPlans.find((row) => row.id === input.id); if (!item || !canClass(ctx, item.classId)) throw new Error("无权查看该周训练计划"); return planView(data, item); }
  if (action === "saveWeeklyTrainingPlan") {
    staff(ctx); const raw = input.plan || {}, old = raw.id && data.weeklyTrainingPlans.find((item) => item.id === raw.id); if (old && !canClass(ctx, old.classId)) throw new Error("无权修改该周训练计划");
    const classId = String(raw.classId || (old || {}).classId || ""); if (!canClass(ctx, classId)) throw new Error("只能制定自己负责班级的周计划"); const clubClass = data.classes.find((item) => item.id === classId && item.status !== "INACTIVE"); if (!clubClass) throw new Error("班级不存在或已停用");
    const trainingFocus = focusList(raw.trainingFocus), weekStart = String(raw.weekStart || ""), weekEnd = String(raw.weekEnd || ""); if (!weekStart || !weekEnd || weekStart > weekEnd || !String(raw.mainTheme || "").trim() || !trainingFocus.length) throw new Error("周训练计划信息不完整");
    if (data.weeklyTrainingPlans.some((item) => item.id !== raw.id && item.classId === classId && item.weekStart === weekStart && item.status !== "COMPLETED")) throw new Error("该班级本周已有训练计划");
    const item = { id: raw.id || ctx.uid("wp"), classId, coachId: ctx.role === "coach" ? ctx.userId : String(raw.coachId || (old || {}).coachId || clubClass.coachUserId || ""), coachName: ctx.role === "coach" ? ctx.userName : String(raw.coachName || (old || {}).coachName || clubClass.headCoachName || ""), weekStart, weekEnd, mainTheme: String(raw.mainTheme || "").trim(), themeKey: String(raw.themeKey || ""), trainingFocus, curriculumId: String(raw.curriculumId || ""), status: old ? old.status || "DRAFT" : "DRAFT", meetingNote: String(raw.meetingNote === undefined ? (old || {}).meetingNote || "" : raw.meetingNote), updatedBy: ctx.userId, updatedAt: ctx.stamp(), createdAt: old ? old.createdAt : ctx.stamp() };
    if (old) Object.assign(old, item); else data.weeklyTrainingPlans.push(item); ctx.audit(old ? "UPDATE_WEEKLY_TRAINING_PLAN" : "CREATE_WEEKLY_TRAINING_PLAN", "weeklyTrainingPlan", item.id, { classId, status: item.status }); ctx.save(); return { id: item.id };
  }
  if (action === "confirmWeeklyTrainingPlan") { staff(ctx); const item = data.weeklyTrainingPlans.find((row) => row.id === input.id); if (!item || !canClass(ctx, item.classId)) throw new Error("无权确认该周训练计划"); item.status = input.completed ? "COMPLETED" : "CONFIRMED"; if (input.meetingNote !== undefined) item.meetingNote = String(input.meetingNote || ""); item.updatedBy = ctx.userId; item.updatedAt = ctx.stamp(); ctx.audit("CONFIRM_WEEKLY_TRAINING_PLAN", "weeklyTrainingPlan", item.id, { classId: item.classId, status: item.status }); ctx.save(); return { ok: true, status: item.status }; }
  if (action === "saveSessionTrainingInfo") {
    staff(ctx); const session = data.sessions.find((item) => item.id === input.sessionId); if (!session || !canClass(ctx, session.classId)) throw new Error("无权修改该课程训练信息");
    const trainingTheme = String(input.trainingTheme || "").trim(), trainingFocus = focusText(input.trainingFocus); if (!trainingTheme || !trainingFocus) throw new Error("请填写训练主题和训练重点"); const weekly = input.weeklyTrainingPlanId && data.weeklyTrainingPlans.find((item) => item.id === input.weeklyTrainingPlanId); if (input.weeklyTrainingPlanId && (!weekly || weekly.classId !== session.classId)) throw new Error("周训练计划与课程班级不一致");
    Object.assign(session, { trainingTheme, trainingThemeKey: String(input.trainingThemeKey || ""), trainingFocus, focus: trainingFocus, trainingNote: String(input.trainingNote || ""), weeklyTrainingPlanId: String(input.weeklyTrainingPlanId || ""), updatedBy: ctx.userId, updatedAt: ctx.stamp() }); ctx.audit("SAVE_SESSION_TRAINING_INFO", "session", session.id, { classId: session.classId, trainingTheme }); ctx.save(); return { ok: true };
  }
  if (action === "getSessionTrainingInfo" || action === "getSessionTrainingPlan") {
    const session = data.sessions.find((item) => item.id === input.sessionId); if (!session) throw new Error("课程不存在"); const weekly = data.weeklyTrainingPlans.find((item) => item.id === session.weeklyTrainingPlanId); const value = { session: { id: session.id, title: session.title, date: session.date, time: session.time, classId: session.classId }, trainingTheme: session.trainingTheme || "", trainingThemeKey: session.trainingThemeKey || "", trainingFocus: String(session.trainingFocus || session.focus || ""), weeklyTrainingPlanId: session.weeklyTrainingPlanId || "", weeklyTheme: weekly ? weekly.mainTheme : "" };
    if (ctx.role === "parent") { if (!ctx.canAccessStudent(input.studentId)) throw new Error("无权查看该孩子训练信息"); if (!(data.classMembers || []).some((item) => item.classId === session.classId && item.studentId === input.studentId && item.status === "ACTIVE")) throw new Error("该学员不是本课程班级成员"); return value; }
    staff(ctx); if (!canClass(ctx, session.classId)) throw new Error("无权查看该课程训练信息"); return { ...value, trainingNote: session.trainingNote || "", weeklyPlan: weekly ? planView(data, weekly) : null };
  }
  if (action === "getParentClassTrainingOverview") {
    if (ctx.role !== "parent") throw new Error("仅家长可读取家长版培养内容");
    const classId = String(input.classId || ""), clubClass = data.classes.find((item) => item.id === classId), ownIds = new Set(data.students.filter((student) => ctx.canAccessStudent(student.id)).map((student) => student.id));
    if (!clubClass || !(data.classMembers || []).some((item) => item.classId === classId && item.status === "ACTIVE" && ownIds.has(item.studentId))) throw new Error("无权查看该班级培养内容");
    const today = ctx.stamp().slice(0, 10);
    const weekly = data.weeklyTrainingPlans.filter((item) => item.classId === classId && item.status === "CONFIRMED" && item.weekStart <= today && item.weekEnd >= today).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
    const active = data.curriculums.filter((item) => item.active !== false && (item.classType || "REGULAR") === (clubClass.classType || "REGULAR") && ageMatches(clubClass.ageGroup, item.ageGroup));
    let curriculum = weekly && weekly.curriculumId ? active.find((item) => item.id === weekly.curriculumId) : null; if (!curriculum) curriculum = active.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))[0] || null;
    return { classId, ageStage: curriculum ? curriculum.ageGroup : clubClass.ageGroup || "", curriculum: curriculum ? { curriculumId: curriculum.id, name: curriculum.name || "", parentSummary: curriculum.description || "", parentGoals: (curriculum.objectives || []).map(String), parentTrainingAreas: (curriculum.trainingTopics || []).map((key) => TRAINING_TOPICS[key] || key) } : null, weeklyPlan: weekly ? { weekStart: weekly.weekStart || "", weekEnd: weekly.weekEnd || "", mainTheme: weekly.mainTheme || "", trainingFocus: focusList(weekly.trainingFocus) } : null };
  }
  if (action === "getResearchDashboard") { staff(ctx); const plans = data.weeklyTrainingPlans.filter((item) => canClass(ctx, item.classId)), sessions = data.sessions.filter((item) => canClass(ctx, item.classId)); return { metrics: { curriculums: data.curriculums.filter((item) => item.active !== false).length, weeklyPlans: plans.length, confirmedPlans: plans.filter((item) => item.status === "CONFIRMED").length, sessions: sessions.length, filledSessions: sessions.filter((item) => item.trainingTheme && String(item.trainingFocus || "").trim()).length }, weeklyPlans: plans.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).slice(0, 20).map((item) => planView(data, item)) }; }
  throw new Error("未知训练管理操作");
}
module.exports = { ACTIONS, TRAINING_TOPICS, handles: (action) => ACTIONS.has(action), ensure, call };
