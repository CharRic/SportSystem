const CLASS_TYPES = { REGULAR: "普通班", ELITE: "精英队" };
const MEMBER_STATUS = { ACTIVE: "在队", INACTIVE: "已退出" };
const SELECTION_STATUS = { PENDING: "待审核", APPROVED: "已通过", REJECTED: "暂不入选", WITHDRAWN: "已撤销" };
const EXIT_REASONS = ["年龄升级", "调整梯队", "训练表现", "长期缺勤", "转会/离队", "其他"];
const ACTIONS = ["getClassMeta", "getClassDetail", "getParentClassDetail", "searchStudentsForClass", "addClassMember", "joinClass", "removeClassMember", "transferClassMember", "listEliteSelections", "recommendElite", "reviewEliteSelection", "promoteToElite"];

function createClassService({ db, fetchAll, fetchByIds, publicDoc, nowText, requireRole, audit, getCoachReference }) {
  let migrationReady;
  const handles = (action) => ACTIONS.includes(action);
  const activeMembers = (classId) => fetchAll("classMembers", { classId, status: "ACTIVE" });
  const studentMemberships = (studentId) => fetchAll("classMembers", { studentId, status: "ACTIVE" });

  async function normalizeClass(clubClass) {
    const data = {};
    if (!CLASS_TYPES[clubClass.classType]) data.classType = /精英/.test(clubClass.name || "") ? "ELITE" : "REGULAR";
    if (!clubClass.ageGroup) data.ageGroup = clubClass.group || "待补充";
    if (!clubClass.standardCapacity) data.standardCapacity = Number(clubClass.capacity || 20);
    if (!clubClass.headCoachName) data.headCoachName = clubClass.coachName || "待安排";
    if (!clubClass.headCoachUserId && clubClass.coachUserId) data.headCoachUserId = clubClass.coachUserId;
    if (clubClass.assistantCoachName === undefined) data.assistantCoachName = "";
    if (!clubClass.status) data.status = clubClass.active === false ? "INACTIVE" : "ACTIVE";
    if (clubClass.remark === undefined) data.remark = "";
    if (Object.keys(data).length) await db.collection("classes").doc(clubClass._id).update({ data: { ...data, updatedAt: nowText() } });
    return { ...clubClass, ...data, coachName: data.headCoachName || clubClass.headCoachName || clubClass.coachName };
  }

  async function ensureMigration() {
    if (!migrationReady) migrationReady = (async () => {
      const [rawClasses, students, members] = await Promise.all([fetchAll("classes"), fetchAll("students"), fetchAll("classMembers")]);
      const classes = []; for (const item of rawClasses) classes.push(await normalizeClass(item));
      const pairs = new Set(); students.forEach((student) => (student.classIds || []).forEach((classId) => pairs.add(`${classId}|${student._id}`))); classes.forEach((clubClass) => (clubClass.studentIds || []).forEach((studentId) => pairs.add(`${clubClass._id}|${studentId}`)));
      for (const pair of pairs) { const [classId, studentId] = pair.split("|"); if (members.some((item) => item.classId === classId && item.studentId === studentId)) continue; const clubClass = classes.find((item) => item._id === classId); if (!clubClass || !students.some((item) => item._id === studentId)) continue; await db.collection("classMembers").add({ data: { classId, studentId, memberType: clubClass.classType, status: "ACTIVE", joinedAt: nowText(), joinedBy: "migration", source: "LEGACY_MIGRATION", remark: "由原班级关系兼容迁移", createdAt: nowText(), updatedAt: nowText() } }); }
    })();
    return migrationReady;
  }

  async function syncLegacy(studentId, classId) {
    const [studentRows, classRows] = await Promise.all([studentMemberships(studentId), activeMembers(classId)]);
    await Promise.all([db.collection("students").doc(studentId).update({ data: { classIds: studentRows.map((item) => item.classId), updatedAt: nowText() } }), db.collection("classes").doc(classId).update({ data: { studentIds: classRows.map((item) => item.studentId), updatedAt: nowText() } })]);
  }

  async function decorateClass(clubClass) {
    const members = await activeMembers(clubClass._id); const standardCapacity = Math.max(1, Number(clubClass.standardCapacity || 20)); const studentCount = members.length;
    const assistantCoaches = []; for (const coachId of clubClass.assistantCoachIds || []) assistantCoaches.push(getCoachReference ? await getCoachReference(coachId, "") : { name: "", avatarUrl: "" });
    if (!assistantCoaches.length && clubClass.assistantCoachName) for (const name of String(clubClass.assistantCoachName).split(/[、,，]+/).map((item) => item.trim()).filter(Boolean)) assistantCoaches.push(getCoachReference ? await getCoachReference("", name) : { coachId: "", name, avatarUrl: "" });
    return { ...publicDoc(clubClass), headCoach: getCoachReference ? await getCoachReference(clubClass.headCoachUserId || clubClass.coachUserId, clubClass.headCoachName || clubClass.coachName) : { name: clubClass.headCoachName || clubClass.coachName || "", avatarUrl: "" }, assistantCoaches, classTypeLabel: CLASS_TYPES[clubClass.classType] || clubClass.classType, studentCount, standardCapacity, remainingCapacity: Math.max(0, standardCapacity - studentCount), overCapacity: Math.max(0, studentCount - standardCapacity), isFull: studentCount >= standardCapacity, enrollmentLabel: clubClass.classType === "ELITE" ? "俱乐部选拔制" : studentCount >= standardCapacity ? "本班已满" : "可报名" };
  }

  async function parentClassSummary(clubClass) {
    const decorated = await decorateClass(clubClass);
    return { id: decorated.id, name: decorated.name, classCode: decorated.classCode || "", classType: decorated.classType, classTypeLabel: decorated.classTypeLabel, ageGroup: decorated.ageGroup || "", schedule: decorated.schedule || "", venue: decorated.venue || "", headCoach: decorated.headCoach, assistantCoaches: decorated.assistantCoaches || [], studentCount: decorated.studentCount, canViewRoster: false, classmates: [], upcomingSessions: [] };
  }

  function isPublishedSession(session) {
    return session.publishStatus === "PUBLISHED" || ["published", "COMPLETED", "CANCELLED"].includes(session.status);
  }

  async function parentClassDetail(user, classId) {
    requireRole(user, ["parent"]);
    const ownedStudents = await fetchAll("students", { ownerParentUserId: user._id, status: "active" });
    const ownedIds = new Set(ownedStudents.map((item) => item._id));
    const ownedMemberships = (await activeMembers(classId)).filter((item) => ownedIds.has(item.studentId));
    if (!ownedMemberships.length) throw new Error("无权查看该班级成员名单");
    const clubClass = (await db.collection("classes").doc(classId).get()).data;
    if (!clubClass || clubClass.status === "INACTIVE") throw new Error("班级不存在或已停用");
    const members = await activeMembers(classId);
    const students = await fetchByIds("students", members.map((item) => item.studentId));
    const classmates = members.map((member) => {
      const student = students.find((item) => item._id === member.studentId) || {};
      return { studentId: member.studentId, displayName: String(student.name || "学员"), avatarUrl: String(student.avatarUrl || "") };
    });
    const today = nowText().slice(0, 10);
    const sessions = (await fetchAll("sessions", { classId })).filter((item) => isPublishedSession(item) && item.date >= today && item.status !== "CANCELLED").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 6);
    const upcomingSessions = [];
    for (const session of sessions) {
      const assignments = (session.actualCoachAssignments || []).length ? session.actualCoachAssignments : session.plannedCoachAssignments || [];
      const primary = assignments.find((item) => item.role === "HEAD") || assignments[0] || {};
      const coach = getCoachReference ? await getCoachReference(primary.coachId || session.coachUserId || clubClass.headCoachUserId || clubClass.coachUserId, primary.coachId ? "" : session.coachName || clubClass.headCoachName || clubClass.coachName) : { coachId: "", name: session.coachName || clubClass.headCoachName || "", avatarUrl: "" };
      upcomingSessions.push({ sessionId: session._id, date: session.date || "", weekday: session.weekday || "", time: session.time || "", venue: session.venue || "", trainingTheme: session.trainingTheme || session.title || "", coach });
    }
    return { ...(await parentClassSummary(clubClass)), canViewRoster: true, studentCount: classmates.length, classmates, upcomingSessions };
  }

  function assertClassAccess(user, classId) {
    if (user.role === "admin") return;
    if (user.role === "coach" && (user.classIds || []).includes(classId)) return;
    if (user.role === "parent") return;
    throw new Error("无权查看该班级");
  }

  async function capacityWarning(clubClass, student, confirmed) {
    const count = (await activeMembers(clubClass._id)).length, capacity = Number(clubClass.standardCapacity || 20);
    if (count < capacity || confirmed) return null;
    return { requiresConfirmation: true, classId: clubClass._id, className: clubClass.name, studentId: student._id, studentName: student.name, currentCount: count, standardCapacity: capacity, nextCount: count + 1, message: `当前班级已达到标准人数${capacity}人。继续添加后，当前人数将变为${count + 1}人。是否确认添加？` };
  }

  async function createMember(user, input) {
    const [classResult, studentResult] = await Promise.all([db.collection("classes").doc(input.classId).get(), db.collection("students").doc(input.studentId).get()]); const clubClass = classResult.data, student = studentResult.data;
    if (!clubClass || clubClass.status === "INACTIVE") throw new Error("班级不存在或已停用"); if (!student || student.status !== "active") throw new Error("学员不存在或已停用");
    const duplicate = (await db.collection("classMembers").where({ classId: clubClass._id, studentId: student._id, status: "ACTIVE" }).limit(1).get()).data[0]; if (duplicate) return { id: duplicate._id, duplicate: true, message: "该学员已经是本班正式成员。", studentCount: (await activeMembers(clubClass._id)).length };
    const warning = await capacityWarning(clubClass, student, input.confirmCapacity); if (warning) return warning;
    const createdAt = nowText(); const data = { classId: clubClass._id, studentId: student._id, memberType: clubClass.classType || "REGULAR", status: "ACTIVE", joinedAt: input.joinedAt || createdAt, joinedBy: user._id, source: input.source || "ADMIN_ADD", remark: String(input.remark || ""), fromClassId: input.fromClassId || "", selectionId: input.selectionId || "", createdAt, updatedAt: createdAt };
    const added = await db.collection("classMembers").add({ data });
    await syncLegacy(student._id, clubClass._id); const count = (await activeMembers(clubClass._id)).length;
    if (data.source === "ELITE_PROMOTION") {
      const existingEvent = (await db.collection("playerGrowthEvents").where({ studentId: student._id, eventType: "ELITE_PROMOTION", sourceId: clubClass._id }).limit(1).get()).data[0];
      if (!existingEvent) await db.collection("playerGrowthEvents").add({ data: { studentId: student._id, eventType: "ELITE_PROMOTION", sourceId: clubClass._id, title: `进入${clubClass.name}`, description: "经教练推荐与管理员审核进入精英队", eventDate: createdAt.slice(0, 10), visibility: "PARENT_VISIBLE", createdBy: user._id, createdAt } });
    }
    await audit(user, "addClassMember", "classMember", added._id, { operator: user._id, studentId: student._id, fromClassId: input.fromClassId || "", toClassId: clubClass._id, reason: data.source, overCapacity: count > Number(clubClass.standardCapacity || 20) }); return { id: added._id, studentCount: count, overCapacity: Math.max(0, count - Number(clubClass.standardCapacity || 20)) };
  }

  async function inactivateMember(user, member, input) {
    const updatedAt = nowText(); await db.collection("classMembers").doc(member._id).update({ data: { status: "INACTIVE", leftAt: updatedAt, leftBy: user._id, leaveReason: input.reason || "其他", exitedAt: updatedAt, exitReason: input.reason || "其他", exitedBy: user._id, updatedAt } }); await syncLegacy(member.studentId, member.classId); await audit(user, "removeClassMember", "classMember", member._id, { operator: user._id, studentId: member.studentId, fromClassId: member.classId, toClassId: input.toClassId || "", reason: input.reason || "其他" });
  }

  async function memberView(member, student, classes) {
    const memberships = await studentMemberships(student._id); const ids = memberships.map((item) => item.classId); const ownClasses = classes.filter((item) => ids.includes(item._id));
    return { ...publicDoc(member), student: { ...publicDoc(student), initial: (student.name || "学")[0], birthYear: String(student.birthDate || "").slice(0, 4), classNames: ownClasses.map((item) => item.name).join("、"), regularClassNames: ownClasses.filter((item) => item.classType === "REGULAR").map((item) => item.name).join("、"), trainingLevel: ownClasses.some((item) => item.classType === "ELITE") ? "精英队" : "普通班" }, statusLabel: MEMBER_STATUS[member.status] || member.status };
  }

  async function joinClass(user, input) {
    requireRole(user, ["parent"]);
    const student = input.studentId
      ? (await db.collection("students").doc(input.studentId).get()).data
      : (await db.collection("students").where({ ownerParentUserId: user._id, status: "active" }).limit(1).get()).data[0];
    if (!student || student.ownerParentUserId !== user._id) throw new Error("无权为该学员报名");

    const outcome = await db.runTransaction(async (transaction) => {
      const clubClass = (await transaction.collection("classes").doc(input.classId).get()).data;
      if (!clubClass || clubClass.status !== "ACTIVE") throw new Error("班级不存在或已停用");
      if (clubClass.classType === "ELITE") throw new Error("精英队实行俱乐部选拔制");
      const active = (await transaction.collection("classMembers").where({ classId: clubClass._id, status: "ACTIVE" }).limit(100).get()).data;
      const duplicate = active.find((item) => item.studentId === student._id);
      if (duplicate) return { id: duplicate._id, duplicate: true, status: "ACTIVE", message: "已经在本班" };
      if (active.length >= Number(clubClass.standardCapacity || 20)) return { status: "FULL", message: "本班已满" };
      const createdAt = nowText();
      const added = await transaction.collection("classMembers").add({ data: { classId: clubClass._id, studentId: student._id, memberType: "REGULAR", status: "ACTIVE", joinedAt: createdAt, joinedBy: user._id, source: "PARENT_SIGNUP", remark: "", fromClassId: "", selectionId: "", createdAt, updatedAt: createdAt } });
      return { id: added._id, status: "ACTIVE", message: "报名成功", classId: clubClass._id };
    });
    if (outcome.status === "ACTIVE" && !outcome.duplicate) {
      await syncLegacy(student._id, outcome.classId);
      await audit(user, "addClassMember", "classMember", outcome.id, { operator: user._id, studentId: student._id, toClassId: outcome.classId, reason: "PARENT_SIGNUP", overCapacity: false });
    }
    return outcome;
  }

  async function call(action, input, user) {
    await ensureMigration();
    if (["reviewEliteSelection", "promoteToElite"].includes(action) && input.keepSource === undefined) input.keepSource = true;
    if (action === "getClassMeta") { const rows = await fetchAll("classes", { status: "ACTIVE" }); const decorated = []; for (const row of rows) decorated.push(await decorateClass(row)); return { classTypes: CLASS_TYPES, memberStatuses: MEMBER_STATUS, selectionStatuses: SELECTION_STATUS, exitReasons: EXIT_REASONS, regularClasses: decorated.filter((item) => item.classType === "REGULAR"), eliteClasses: decorated.filter((item) => item.classType === "ELITE") }; }
    if (action === "getClassDetail") { assertClassAccess(user, input.id); const clubClass = (await db.collection("classes").doc(input.id).get()).data; if (!clubClass) throw new Error("班级不存在"); if (user.role === "parent") return parentClassSummary(clubClass); const members = await fetchAll("classMembers", { classId: input.id }); const filtered = members.filter((item) => input.includeInactive || item.status === "ACTIVE"); const students = await fetchByIds("students", filtered.map((item) => item.studentId)); const classes = await fetchAll("classes"); const memberRows = []; for (const member of filtered) { const student = students.find((item) => item._id === member.studentId); if (student) memberRows.push(await memberView(member, student, classes)); } const pendingSelectionCount = (await db.collection("eliteSelections").where({ targetEliteClassId: input.id, status: "PENDING" }).count()).total; return { ...(await decorateClass(clubClass)), members: memberRows, pendingSelectionCount }; }
    if (action === "getParentClassDetail") return parentClassDetail(user, input.id);
    if (action === "searchStudentsForClass") { requireRole(user, ["admin"]); const [students, classes, members] = await Promise.all([fetchAll("students", { status: "active" }), fetchAll("classes"), fetchAll("classMembers", { status: "ACTIVE" })]); const query = String(input.query || "").trim().toLowerCase(); return students.filter((student) => { const ids = members.filter((item) => item.studentId === student._id).map((item) => item.classId); const names = classes.filter((item) => ids.includes(item._id)).map((item) => item.name); return !query || [student.name, student.guardianName, student.guardianPhone, String(student.birthDate || "").slice(0, 4), names.join("、")].join(" ").toLowerCase().includes(query); }).map((student) => { const ids = members.filter((item) => item.studentId === student._id).map((item) => item.classId); const own = classes.filter((item) => ids.includes(item._id)); return { ...publicDoc(student), classNames: own.map((item) => item.name).join("、"), trainingLevel: own.some((item) => item.classType === "ELITE") ? "精英队" : "普通班" }; }); }
    if (action === "addClassMember") { requireRole(user, ["admin"]); return createMember(user, { ...input, source: input.source || "ADMIN_ADD" }); }
    if (action === "joinClass") return joinClass(user, input);
    if (action === "removeClassMember") { requireRole(user, ["admin"]); const member = (await db.collection("classMembers").doc(input.memberId).get()).data; if (!member || member.status !== "ACTIVE") throw new Error("成员关系不存在或已退出"); await inactivateMember(user, member, input); return { ok: true }; }
    if (action === "transferClassMember") { requireRole(user, ["admin"]); const source = (await db.collection("classMembers").doc(input.memberId).get()).data; if (!source || source.status !== "ACTIVE") throw new Error("原班级成员关系不存在"); if (source.classId === input.targetClassId) throw new Error("目标班级不能与原班级相同"); const [target, student] = await Promise.all([db.collection("classes").doc(input.targetClassId).get(), db.collection("students").doc(source.studentId).get()]); const warning = await capacityWarning(target.data, student.data, input.confirmCapacity); if (warning) return warning; const added = await createMember(user, { classId: input.targetClassId, studentId: source.studentId, source: "TRANSFER", fromClassId: source.classId, confirmCapacity: true, remark: input.reason || "转班" }); if (!input.keepSource) await inactivateMember(user, source, { reason: input.reason || "调整梯队", toClassId: input.targetClassId }); await audit(user, "transferClassMember", "student", source.studentId, { operator: user._id, studentId: source.studentId, fromClassId: source.classId, toClassId: input.targetClassId, reason: input.reason || "转班", keepSource: Boolean(input.keepSource) }); return { ...added, ok: true }; }
    if (action === "recommendElite") { requireRole(user, ["admin", "coach"]); const target = (await db.collection("classes").doc(input.targetEliteClassId).get()).data; if (!target || target.classType !== "ELITE") throw new Error("请选择目标精英队"); if (user.role === "coach" && !(user.classIds || []).includes(input.fromClassId)) throw new Error("无权推荐该学员"); if (user.role === "coach" && !(await db.collection("classMembers").where({ classId: input.fromClassId, studentId: input.studentId, status: "ACTIVE" }).limit(1).get()).data.length) throw new Error("只能推荐自己负责班级的学员"); const reason = String(input.recommendationReason || "").trim(); if (!reason) throw new Error("请填写推荐理由"); const duplicate = (await db.collection("eliteSelections").where({ studentId: input.studentId, targetEliteClassId: target._id, status: "PENDING" }).limit(1).get()).data[0]; if (duplicate) throw new Error("该学员已有待审核推荐"); const createdAt = nowText(); const data = { studentId: input.studentId, fromClassId: input.fromClassId || "", targetEliteClassId: target._id, recommendationSource: user.role === "coach" ? "COACH_RECOMMENDATION" : "ADMIN_RECOMMENDATION", recommendedBy: user._id, recommenderName: user.name, recommendationReason: reason, status: "PENDING", createdAt, updatedAt: createdAt }; const added = await db.collection("eliteSelections").add({ data }); await audit(user, "recommendElite", "eliteSelection", added._id, { operator: user._id, studentId: data.studentId, fromClassId: data.fromClassId, toClassId: data.targetEliteClassId, reason }); return { id: added._id, status: data.status }; }
    if (action === "listEliteSelections") { requireRole(user, ["admin", "coach"]); let rows = await fetchAll("eliteSelections"); if (user.role === "coach") rows = rows.filter((item) => item.recommendedBy === user._id); const students = await fetchByIds("students", rows.map((item) => item.studentId)), classes = await fetchByIds("classes", rows.flatMap((item) => [item.fromClassId, item.targetEliteClassId])); return rows.map((item) => ({ ...publicDoc(item), student: publicDoc(students.find((student) => student._id === item.studentId)), fromClass: publicDoc(classes.find((clubClass) => clubClass._id === item.fromClassId)), targetClass: publicDoc(classes.find((clubClass) => clubClass._id === item.targetEliteClassId)), statusLabel: SELECTION_STATUS[item.status] || item.status })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
    if (action === "reviewEliteSelection") { requireRole(user, ["admin"]); const selection = (await db.collection("eliteSelections").doc(input.id).get()).data; if (!selection || selection.status !== "PENDING") throw new Error("推荐记录不存在或已审核"); if (!input.approved) { const reviewedAt = nowText(); await db.collection("eliteSelections").doc(selection._id).update({ data: { status: "REJECTED", reviewedBy: user._id, reviewRemark: input.reviewRemark || "暂不入选", reviewedAt, updatedAt: reviewedAt } }); await audit(user, "reviewEliteSelection", "eliteSelection", selection._id, { operator: user._id, studentId: selection.studentId, fromClassId: selection.fromClassId, toClassId: selection.targetEliteClassId, reason: input.reviewRemark || "暂不入选", status: "REJECTED" }); return { ok: true, status: "REJECTED" }; } const [target, student] = await Promise.all([db.collection("classes").doc(selection.targetEliteClassId).get(), db.collection("students").doc(selection.studentId).get()]); const warning = await capacityWarning(target.data, student.data, input.confirmCapacity); if (warning) return warning; const added = await createMember(user, { classId: target.data._id, studentId: student.data._id, source: "ELITE_PROMOTION", fromClassId: selection.fromClassId, selectionId: selection._id, confirmCapacity: true, remark: selection.recommendationReason }); if (!input.keepSource && selection.fromClassId) { const source = (await db.collection("classMembers").where({ classId: selection.fromClassId, studentId: student.data._id, status: "ACTIVE" }).limit(1).get()).data[0]; if (source) await inactivateMember(user, source, { reason: "调整梯队", toClassId: target.data._id }); } const reviewedAt = nowText(); await db.collection("eliteSelections").doc(selection._id).update({ data: { status: "APPROVED", reviewedBy: user._id, reviewRemark: input.reviewRemark || "同意入队", reviewedAt, updatedAt: reviewedAt } }); await audit(user, "reviewEliteSelection", "eliteSelection", selection._id, { operator: user._id, studentId: student.data._id, fromClassId: selection.fromClassId, toClassId: target.data._id, reason: input.reviewRemark || "同意入队", status: "APPROVED", keepSource: input.keepSource !== false }); return { ...added, ok: true, status: "APPROVED" }; }
    if (action === "promoteToElite") { requireRole(user, ["admin"]); const [target, student] = await Promise.all([db.collection("classes").doc(input.targetEliteClassId).get(), db.collection("students").doc(input.studentId).get()]); if (!target.data || target.data.classType !== "ELITE" || !student.data) throw new Error("晋升信息无效"); const warning = await capacityWarning(target.data, student.data, input.confirmCapacity); if (warning) return warning; const createdAt = nowText(); const selection = { studentId: student.data._id, fromClassId: input.fromClassId || "", targetEliteClassId: target.data._id, recommendationSource: "ADMIN_DIRECT", recommendedBy: user._id, recommenderName: user.name, recommendationReason: input.reason || "管理员直接选拔", status: "APPROVED", reviewedBy: user._id, reviewRemark: input.reason || "管理员确认入队", createdAt, reviewedAt: createdAt, updatedAt: createdAt }; const selected = await db.collection("eliteSelections").add({ data: selection }); const added = await createMember(user, { classId: target.data._id, studentId: student.data._id, source: "ELITE_PROMOTION", fromClassId: selection.fromClassId, selectionId: selected._id, confirmCapacity: true, remark: selection.recommendationReason }); if (!input.keepSource && selection.fromClassId) { const source = (await db.collection("classMembers").where({ classId: selection.fromClassId, studentId: student.data._id, status: "ACTIVE" }).limit(1).get()).data[0]; if (source) await inactivateMember(user, source, { reason: "调整梯队", toClassId: target.data._id }); } await audit(user, "promoteToElite", "eliteSelection", selected._id, { operator: user._id, studentId: student.data._id, fromClassId: selection.fromClassId, toClassId: target.data._id, reason: selection.recommendationReason, keepSource: input.keepSource !== false }); return { ...added, ok: true, selectionId: selected._id }; }
    throw new Error(`暂不支持班级操作：${action}`);
  }

  return { handles, call, ensureMigration, decorateClass, activeMembers, studentMemberships, syncLegacy, constants: { CLASS_TYPES, MEMBER_STATUS, SELECTION_STATUS, EXIT_REASONS } };
}

module.exports = { createClassService };
