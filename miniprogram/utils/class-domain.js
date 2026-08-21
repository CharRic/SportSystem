const CLASS_TYPES = { REGULAR: "普通班", ELITE: "精英队" };
const MEMBER_STATUS = { ACTIVE: "在队", INACTIVE: "已退出" };
const SELECTION_STATUS = { PENDING: "待审核", APPROVED: "已通过", REJECTED: "暂不入选", WITHDRAWN: "已撤销" };
const EXIT_REASONS = ["年龄升级", "调整梯队", "训练表现", "长期缺勤", "转会/离队", "其他"];

const ACTIONS = [
  "getClassMeta", "getClassDetail", "searchStudentsForClass", "addClassMember", "joinClass",
  "removeClassMember", "transferClassMember", "listEliteSelections", "recommendElite",
  "reviewEliteSelection", "promoteToElite"
];

function handles(action) { return ACTIONS.includes(action); }
function activeMembers(data, classId) { return (data.classMembers || []).filter((item) => item.classId === classId && item.status === "ACTIVE"); }
function activeClassIds(data, studentId) { return (data.classMembers || []).filter((item) => item.studentId === studentId && item.status === "ACTIVE").map((item) => item.classId); }
function getClass(data, id) { return data.classes.find((item) => item.id === id); }
function getStudent(data, id) { return data.students.find((item) => item.id === id); }
function now(ctx) { return ctx.stamp(); }

function syncLegacy(data) {
  data.students.forEach((student) => { student.classIds = activeClassIds(data, student.id); });
  data.classes.forEach((clubClass) => { clubClass.studentIds = activeMembers(data, clubClass.id).map((item) => item.studentId); });
}

function ensure(data, ctx) {
  data.classMembers = data.classMembers || [];
  data.eliteSelections = data.eliteSelections || [];
  data.classes.forEach((clubClass) => {
    clubClass.classType = clubClass.classType || (/精英/.test(clubClass.name || "") ? "ELITE" : "REGULAR");
    clubClass.ageGroup = clubClass.ageGroup || clubClass.group || "待补充";
    clubClass.standardCapacity = Math.max(1, Number(clubClass.standardCapacity || clubClass.capacity || 20));
    clubClass.headCoachName = clubClass.headCoachName || clubClass.coachName || "待安排";
    clubClass.headCoachUserId = clubClass.headCoachUserId || clubClass.coachUserId || "";
    clubClass.coachName = clubClass.headCoachName;
    clubClass.assistantCoachName = clubClass.assistantCoachName || "";
    clubClass.status = clubClass.status || (clubClass.active === false ? "INACTIVE" : "ACTIVE");
    clubClass.active = clubClass.status === "ACTIVE";
    clubClass.remark = clubClass.remark || "";
    const coach = (data.users || []).find((item) => item.id === clubClass.headCoachUserId && item.role === "coach");
    if (coach) coach.classIds = [...new Set([...(coach.classIds || []), clubClass.id])];
  });
  const pairs = new Set();
  data.students.forEach((student) => (student.classIds || []).forEach((classId) => pairs.add(`${classId}|${student.id}`)));
  data.classes.forEach((clubClass) => (clubClass.studentIds || []).forEach((studentId) => pairs.add(`${clubClass.id}|${studentId}`)));
  pairs.forEach((pair) => {
    const [classId, studentId] = pair.split("|");
    if (!getClass(data, classId) || !getStudent(data, studentId)) return;
    if (data.classMembers.some((item) => item.classId === classId && item.studentId === studentId)) return;
    const clubClass = getClass(data, classId);
    const createdAt = now(ctx);
    data.classMembers.push({ id: ctx.uid("cm"), classId, studentId, memberType: clubClass.classType, status: "ACTIVE", joinedAt: createdAt, joinedBy: "migration", source: "LEGACY_MIGRATION", remark: "由原班级关系兼容迁移", createdAt, updatedAt: createdAt });
  });
  syncLegacy(data);
}

function decorateClass(data, clubClass) {
  const studentCount = activeMembers(data, clubClass.id).length;
  const standardCapacity = Math.max(1, Number(clubClass.standardCapacity || 20));
  return { ...clubClass, classTypeLabel: CLASS_TYPES[clubClass.classType] || clubClass.classType, studentCount, standardCapacity, remainingCapacity: Math.max(0, standardCapacity - studentCount), overCapacity: Math.max(0, studentCount - standardCapacity), isFull: studentCount >= standardCapacity, enrollmentLabel: clubClass.classType === "ELITE" ? "俱乐部选拔制" : studentCount >= standardCapacity ? "本班已满" : "可报名" };
}

function assertClassAccess(data, role, userId, classId) {
  if (role === "admin") return;
  if (role === "coach" && ((((data.users || []).find((item) => item.id === userId) || {}).classIds) || []).includes(classId)) return;
  if (role === "parent" && getClass(data, classId) && getClass(data, classId).status === "ACTIVE") return;
  throw new Error("无权查看该班级");
}

function capacityResult(data, clubClass, student, confirmed) {
  const count = activeMembers(data, clubClass.id).length;
  const capacity = Number(clubClass.standardCapacity || 20);
  if (count < capacity || confirmed) return null;
  return { requiresConfirmation: true, classId: clubClass.id, className: clubClass.name, studentId: student.id, studentName: student.name, currentCount: count, standardCapacity: capacity, nextCount: count + 1, message: `当前班级已达到标准人数${capacity}人。继续添加后，当前人数将变为${count + 1}人。是否确认添加？` };
}

function createMember(data, input, ctx) {
  const clubClass = getClass(data, input.classId), student = getStudent(data, input.studentId);
  if (!clubClass || clubClass.status !== "ACTIVE") throw new Error("班级不存在或已停用");
  if (!student || student.status !== "active") throw new Error("学员不存在或已停用");
  const duplicate = (data.classMembers || []).find((item) => item.classId === clubClass.id && item.studentId === student.id && item.status === "ACTIVE");
  if (duplicate) return { id: duplicate.id, duplicate: true, message: "该学员已经是本班正式成员。", studentCount: activeMembers(data, clubClass.id).length };
  const warning = capacityResult(data, clubClass, student, input.confirmCapacity);
  if (warning) return warning;
  const createdAt = now(ctx);
  const item = { id: ctx.uid("cm"), classId: clubClass.id, studentId: student.id, memberType: clubClass.classType, status: "ACTIVE", joinedAt: input.joinedAt || createdAt, joinedBy: ctx.userId, source: input.source || "ADMIN_ADD", remark: String(input.remark || ""), fromClassId: input.fromClassId || "", selectionId: input.selectionId || "", createdAt, updatedAt: createdAt };
  data.classMembers.push(item);
  if (item.source === "ELITE_PROMOTION") {
    data.playerGrowthEvents = data.playerGrowthEvents || [];
    if (!data.playerGrowthEvents.some((event) => event.studentId === student.id && event.eventType === "ELITE_PROMOTION" && event.sourceId === clubClass.id)) data.playerGrowthEvents.push({ id: ctx.uid("ge"), studentId: student.id, eventType: "ELITE_PROMOTION", sourceId: clubClass.id, title: `进入${clubClass.name}`, description: "经教练推荐与管理员审核进入精英队", eventDate: createdAt.slice(0, 10), visibility: "PARENT_VISIBLE", createdBy: ctx.userId, createdAt });
  }
  syncLegacy(data);
  ctx.audit("addClassMember", "classMember", item.id, { operator: ctx.userId, studentId: student.id, fromClassId: input.fromClassId || "", toClassId: clubClass.id, reason: item.source, overCapacity: activeMembers(data, clubClass.id).length > Number(clubClass.standardCapacity || 20) });
  return { id: item.id, studentCount: activeMembers(data, clubClass.id).length, overCapacity: Math.max(0, activeMembers(data, clubClass.id).length - Number(clubClass.standardCapacity || 20)) };
}

function inactivateMember(data, member, input, ctx) {
  member.status = "INACTIVE";
  member.leftAt = member.exitedAt = now(ctx);
  member.leaveReason = member.exitReason = input.reason || "其他";
  member.leftBy = member.exitedBy = ctx.userId;
  member.updatedAt = member.leftAt;
  syncLegacy(data);
  ctx.audit("removeClassMember", "classMember", member.id, { operator: ctx.userId, studentId: member.studentId, fromClassId: member.classId, toClassId: input.toClassId || "", reason: member.exitReason });
}

function memberView(data, member) {
  const student = getStudent(data, member.studentId) || {};
  const classIds = activeClassIds(data, member.studentId);
  const classes = data.classes.filter((item) => classIds.includes(item.id));
  const latestFeedback = (data.feedback || []).filter((item) => item.studentId === member.studentId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const latestSelection = (data.eliteSelections || []).filter((item) => item.studentId === member.studentId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  return { ...member, student: { ...student, initial: (student.name || "学")[0], birthYear: String(student.birthDate || "").slice(0, 4), classNames: classes.map((item) => item.name).join("、"), regularClassNames: classes.filter((item) => item.classType === "REGULAR").map((item) => item.name).join("、"), trainingLevel: classes.some((item) => item.classType === "ELITE") ? "精英队" : "普通班" }, latestFeedback: latestFeedback || null, latestSelection: latestSelection || null, statusLabel: MEMBER_STATUS[member.status] || member.status };
}

async function call(action, input, ctx) {
  const { data, role, userId } = ctx;
  ensure(data, ctx);
  if (action === "getClassMeta") return { classTypes: CLASS_TYPES, memberStatuses: MEMBER_STATUS, selectionStatuses: SELECTION_STATUS, exitReasons: EXIT_REASONS, regularClasses: data.classes.filter((item) => item.classType === "REGULAR" && item.status === "ACTIVE").map((item) => decorateClass(data, item)), eliteClasses: data.classes.filter((item) => item.classType === "ELITE" && item.status === "ACTIVE").map((item) => decorateClass(data, item)) };
  if (action === "getClassDetail") {
    assertClassAccess(data, role, userId, input.id);
    const clubClass = getClass(data, input.id); if (!clubClass) throw new Error("班级不存在");
    const members = role === "parent" ? [] : (data.classMembers || []).filter((item) => item.classId === clubClass.id && (input.includeInactive || item.status === "ACTIVE")).sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt))).map((item) => memberView(data, item));
    return { ...decorateClass(data, clubClass), members, pendingSelectionCount: (data.eliteSelections || []).filter((item) => item.targetEliteClassId === clubClass.id && item.status === "PENDING").length };
  }
  if (action === "searchStudentsForClass") {
    if (role !== "admin") throw new Error("仅管理员可搜索并编班");
    const query = String(input.query || "").trim().toLowerCase();
    return data.students.filter((item) => item.status === "active").filter((student) => { const classes = data.classes.filter((item) => activeClassIds(data, student.id).includes(item.id)); const text = [student.name, student.guardianName, student.guardianPhone, String(student.birthDate || "").slice(0, 4), classes.map((item) => item.name).join("、")].join(" ").toLowerCase(); return !query || text.includes(query); }).map((student) => { const classes = data.classes.filter((item) => activeClassIds(data, student.id).includes(item.id)); return { ...student, classNames: classes.map((item) => item.name).join("、"), trainingLevel: classes.some((item) => item.classType === "ELITE") ? "精英队" : "普通班" }; });
  }
  if (action === "addClassMember") {
    if (role !== "admin") throw new Error("仅管理员可人工添加学员");
    const result = createMember(data, { ...input, source: input.source || "ADMIN_ADD" }, ctx); ctx.save(); return result;
  }
  if (action === "joinClass") {
    if (role !== "parent") throw new Error("家长报名仅限家长端操作");
    const studentId = input.studentId || (data.students.find((item) => ctx.canAccessStudent(item.id)) || {}).id;
    if (!ctx.canAccessStudent(studentId)) throw new Error("无权为该学员报名");
    const clubClass = getClass(data, input.classId); if (!clubClass) throw new Error("班级不存在");
    if (clubClass.classType === "ELITE") throw new Error("精英队实行俱乐部选拔制");
    if (activeMembers(data, clubClass.id).length >= Number(clubClass.standardCapacity || 20)) return { status: "FULL", message: "本班已满" };
    const result = createMember(data, { ...input, studentId, source: "PARENT_SIGNUP", confirmCapacity: false }, ctx); ctx.save(); return { ...result, status: "ACTIVE", message: result.duplicate ? "已经在本班" : "报名成功" };
  }
  if (action === "removeClassMember") {
    if (role !== "admin") throw new Error("仅管理员可移出队员");
    const member = (data.classMembers || []).find((item) => item.id === input.memberId && item.status === "ACTIVE"); if (!member) throw new Error("成员关系不存在或已退出");
    inactivateMember(data, member, input, ctx); ctx.save(); return { ok: true };
  }
  if (action === "transferClassMember") {
    if (role !== "admin") throw new Error("仅管理员可执行转班");
    const source = (data.classMembers || []).find((item) => item.id === input.memberId && item.status === "ACTIVE"); if (!source) throw new Error("原班级成员关系不存在");
    if (source.classId === input.targetClassId) throw new Error("目标班级不能与原班级相同");
    const target = getClass(data, input.targetClassId), student = getStudent(data, source.studentId); if (!target || !student) throw new Error("目标班级或学员不存在");
    const warning = capacityResult(data, target, student, input.confirmCapacity); if (warning) return warning;
    const added = createMember(data, { classId: target.id, studentId: student.id, source: "TRANSFER", fromClassId: source.classId, confirmCapacity: true, remark: input.reason || "转班" }, ctx);
    if (!input.keepSource) inactivateMember(data, source, { reason: input.reason || "调整梯队", toClassId: target.id }, ctx);
    ctx.audit("transferClassMember", "student", student.id, { operator: userId, studentId: student.id, fromClassId: source.classId, toClassId: target.id, reason: input.reason || "转班", keepSource: Boolean(input.keepSource) });
    ctx.save(); return { ...added, ok: true };
  }
  if (action === "recommendElite") {
    if (!["admin", "coach"].includes(role)) throw new Error("仅管理员或教练可提交精英队推荐");
    const target = getClass(data, input.targetEliteClassId); if (!target || target.classType !== "ELITE") throw new Error("请选择目标精英队");
    if (!ctx.canAccessStudent(input.studentId)) throw new Error("无权推荐该学员");
    if (role === "coach" && !activeMembers(data, input.fromClassId).some((item) => item.studentId === input.studentId)) throw new Error("只能推荐自己负责班级的学员");
    const reason = String(input.recommendationReason || "").trim(); if (!reason) throw new Error("请填写推荐理由");
    const duplicate = (data.eliteSelections || []).find((item) => item.studentId === input.studentId && item.targetEliteClassId === target.id && item.status === "PENDING"); if (duplicate) throw new Error("该学员已有待审核推荐");
    const createdAt = now(ctx); const item = { id: ctx.uid("es"), studentId: input.studentId, fromClassId: input.fromClassId || "", targetEliteClassId: target.id, recommendationSource: role === "coach" ? "COACH_RECOMMENDATION" : "ADMIN_RECOMMENDATION", recommendedBy: userId, recommenderName: ctx.userName, recommendationReason: reason, status: "PENDING", createdAt, updatedAt: createdAt };
    data.eliteSelections.unshift(item); ctx.audit("recommendElite", "eliteSelection", item.id, { operator: userId, studentId: item.studentId, fromClassId: item.fromClassId, toClassId: item.targetEliteClassId, reason }); ctx.save(); return { id: item.id, status: item.status };
  }
  if (action === "listEliteSelections") {
    if (!["admin", "coach"].includes(role)) throw new Error("无权查看精英队推荐");
    return (data.eliteSelections || []).filter((item) => role === "admin" || item.recommendedBy === userId).map((item) => ({ ...item, student: getStudent(data, item.studentId), fromClass: getClass(data, item.fromClassId), targetClass: getClass(data, item.targetEliteClassId), statusLabel: SELECTION_STATUS[item.status] || item.status })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  if (action === "reviewEliteSelection") {
    if (role !== "admin") throw new Error("仅管理员可审核精英队推荐");
    const selection = (data.eliteSelections || []).find((item) => item.id === input.id && item.status === "PENDING"); if (!selection) throw new Error("推荐记录不存在或已审核");
    if (!input.approved) { selection.status = "REJECTED"; selection.reviewedBy = userId; selection.reviewRemark = input.reviewRemark || "暂不入选"; selection.reviewedAt = now(ctx); selection.updatedAt = selection.reviewedAt; ctx.audit("reviewEliteSelection", "eliteSelection", selection.id, { operator: userId, studentId: selection.studentId, fromClassId: selection.fromClassId, toClassId: selection.targetEliteClassId, reason: selection.reviewRemark, status: selection.status }); ctx.save(); return { ok: true, status: selection.status }; }
    const target = getClass(data, selection.targetEliteClassId), student = getStudent(data, selection.studentId); const warning = capacityResult(data, target, student, input.confirmCapacity); if (warning) return warning;
    const added = createMember(data, { classId: target.id, studentId: student.id, source: "ELITE_PROMOTION", fromClassId: selection.fromClassId, selectionId: selection.id, confirmCapacity: true, remark: selection.recommendationReason }, ctx);
    if (!input.keepSource && selection.fromClassId) { const source = (data.classMembers || []).find((item) => item.classId === selection.fromClassId && item.studentId === student.id && item.status === "ACTIVE"); if (source) inactivateMember(data, source, { reason: "调整梯队", toClassId: target.id }, ctx); }
    selection.status = "APPROVED"; selection.reviewedBy = userId; selection.reviewRemark = input.reviewRemark || "同意入队"; selection.reviewedAt = now(ctx); selection.updatedAt = selection.reviewedAt;
    ctx.audit("reviewEliteSelection", "eliteSelection", selection.id, { operator: userId, studentId: student.id, fromClassId: selection.fromClassId, toClassId: target.id, reason: selection.reviewRemark, status: selection.status, keepSource: input.keepSource !== false }); ctx.save(); return { ...added, ok: true, status: selection.status };
  }
  if (action === "promoteToElite") {
    if (role !== "admin") throw new Error("仅管理员可直接晋升精英队");
    const target = getClass(data, input.targetEliteClassId), student = getStudent(data, input.studentId); if (!target || target.classType !== "ELITE" || !student) throw new Error("晋升信息无效");
    const warning = capacityResult(data, target, student, input.confirmCapacity); if (warning) return warning;
    const createdAt = now(ctx); const selection = { id: ctx.uid("es"), studentId: student.id, fromClassId: input.fromClassId || "", targetEliteClassId: target.id, recommendationSource: "ADMIN_DIRECT", recommendedBy: userId, recommenderName: ctx.userName, recommendationReason: input.reason || "管理员直接选拔", status: "APPROVED", reviewedBy: userId, reviewRemark: input.reason || "管理员确认入队", createdAt, reviewedAt: createdAt, updatedAt: createdAt };
    data.eliteSelections.unshift(selection); const added = createMember(data, { classId: target.id, studentId: student.id, source: "ELITE_PROMOTION", fromClassId: selection.fromClassId, selectionId: selection.id, confirmCapacity: true, remark: selection.recommendationReason }, ctx);
    if (!input.keepSource && selection.fromClassId) { const source = (data.classMembers || []).find((item) => item.classId === selection.fromClassId && item.studentId === student.id && item.status === "ACTIVE"); if (source) inactivateMember(data, source, { reason: "调整梯队", toClassId: target.id }, ctx); }
    ctx.audit("promoteToElite", "eliteSelection", selection.id, { operator: userId, studentId: student.id, fromClassId: selection.fromClassId, toClassId: target.id, reason: selection.recommendationReason, keepSource: input.keepSource !== false }); ctx.save(); return { ...added, ok: true, selectionId: selection.id };
  }
  throw new Error(`暂不支持班级操作：${action}`);
}

module.exports = { CLASS_TYPES, MEMBER_STATUS, SELECTION_STATUS, EXIT_REASONS, handles, ensure, syncLegacy, activeMembers, activeClassIds, decorateClass, call };
