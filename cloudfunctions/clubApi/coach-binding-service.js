const crypto = require("crypto");

const ACTIONS = new Set([
  "createCoachInvite",
  "getCoachInvitePreview",
  "confirmCoachBinding",
  "cancelCoachInvite",
  "unbindCoachAccount",
  "setCoachStatus",
]);
const PUBLIC_ACTIONS = new Set(["getCoachInvitePreview", "confirmCoachBinding"]);
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function secureText(length) {
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((value) => ALPHABET[value % ALPHABET.length]).join("").slice(0, length);
}

function coachActive(profile) {
  return Boolean(profile && profile.active !== false && String(profile.status || "ACTIVE").toUpperCase() === "ACTIVE");
}

function createCoachBindingService({ db, fetchAll, nowText, requireRole, audit, findUser, isLegacyPlaceholder, identityHash, createQrCode }) {
  const handles = (action) => ACTIONS.has(action);
  const publicHandles = (action) => PUBLIC_ACTIONS.has(action);

  async function profileById(value) {
    const id = String(value || "");
    if (!id) return null;
    const direct = (await db.collection("coachProfiles").doc(id).get().catch(() => ({ data: null }))).data;
    if (direct) return direct;
    return (await db.collection("coachProfiles").where({ coachUserId: id }).limit(1).get()).data[0] || null;
  }

  async function inviteByCredential(input) {
    const raw = String(input.scene || input.code || input.token || "").trim().toUpperCase();
    const credential = raw.startsWith("CI_") ? raw.slice(3) : raw;
    if (!credential) throw new Error("请输入教练绑定码");
    const hash = digest(credential);
    const rows = await fetchAll("coachInvites");
    const invite = rows.find((item) => item.tokenHash === hash || item.codeHash === hash);
    if (!invite) throw new Error("邀请码不存在");
    if (invite.status === "USED") throw new Error("该邀请已经使用");
    if (invite.status === "CANCELLED") throw new Error("该邀请已经撤销");
    if (invite.status === "EXPIRED" || Number(invite.expiresAt || 0) <= Date.now()) {
      if (invite.status === "ACTIVE") await db.collection("coachInvites").doc(invite._id).update({ data: { status: "EXPIRED", expiredAt: nowText(), updatedAt: nowText() } });
      throw new Error("该邀请已经过期");
    }
    if (invite.status !== "ACTIVE") throw new Error("该邀请当前不可使用");
    return invite;
  }

  async function bindingState(profile) {
    const coachId = profile.coachUserId || profile._id;
    let boundUser = null;
    if (profile.boundUserId) boundUser = (await db.collection("users").doc(profile.boundUserId).get().catch(() => ({ data: null }))).data;
    if (!boundUser) boundUser = (await db.collection("users").where({ coachId, role: "coach" }).limit(1).get()).data[0] || null;
    if (!boundUser) boundUser = (await db.collection("users").doc(coachId).get().catch(() => ({ data: null }))).data;
    const bound = Boolean(boundUser && boundUser.role === "coach" && boundUser.active !== false && String(boundUser.status || "ACTIVE").toUpperCase() === "ACTIVE" && (!boundUser.coachId || boundUser.coachId === coachId));
    return { coachId, bound, boundUser: bound ? boundUser : null };
  }

  async function decorateProfile(profile) {
    const state = await bindingState(profile);
    const invites = (await fetchAll("coachInvites", { coachId: state.coachId })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const current = invites.find((item) => item.status === "ACTIVE" && Number(item.expiresAt || 0) > Date.now()) || invites[0] || null;
    return {
      id: profile._id,
      coachId: state.coachId,
      accountStatus: !coachActive(profile) ? "INACTIVE" : state.bound ? "BOUND" : "UNBOUND",
      accountStatusLabel: !coachActive(profile) ? "已停用" : state.bound ? "已绑定" : "未绑定",
      boundUserId: state.bound ? state.boundUser._id : "",
      boundAt: profile.boundAt || (state.boundUser || {}).coachBoundAt || "",
      lastLoginAt: (state.boundUser || {}).lastLoginAt || "",
      currentInvite: current ? { id: current._id, status: Number(current.expiresAt || 0) <= Date.now() && current.status === "ACTIVE" ? "EXPIRED" : current.status, createdAt: current.createdAt, expiresAt: current.expiresAt, qrFileId: current.qrFileId || "" } : null,
    };
  }

  async function createInvite(input, user) {
    requireRole(user, ["admin"]);
    const profile = await profileById(input.coachId || input.id);
    if (!profile) throw new Error("教练不存在");
    if (!coachActive(profile)) throw new Error("教练已停用，不能生成绑定邀请");
    const state = await bindingState(profile);
    if (state.bound) throw new Error("该教练账号已经完成绑定，如需更换微信请先解除绑定");
    const active = await fetchAll("coachInvites", { coachId: state.coachId, status: "ACTIVE" });
    for (const item of active) await db.collection("coachInvites").doc(item._id).update({ data: { status: "CANCELLED", cancelledAt: nowText(), cancelledBy: user._id, updatedAt: nowText() } });
    let code;
    do { code = `NL${secureText(4)}`; } while ((await fetchAll("coachInvites")).some((item) => item.codeHash === digest(code)));
    const token = secureText(20), scene = `ci_${token}`, createdAt = nowText(), expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const added = await db.collection("coachInvites").add({ data: { codeHash: digest(code), tokenHash: digest(token), coachId: state.coachId, coachProfileId: profile._id, status: "ACTIVE", expiresAt, createdBy: user._id, createdAt, updatedAt: createdAt } });
    let qrFileId = "";
    try {
      qrFileId = await createQrCode(added._id, scene);
      await db.collection("coachInvites").doc(added._id).update({ data: { qrFileId, qrStatus: "READY", updatedAt: nowText() } });
    } catch (error) {
      await db.collection("coachInvites").doc(added._id).update({ data: { status: "CANCELLED", qrStatus: "FAILED", cancelledAt: nowText(), updatedAt: nowText() } });
      throw new Error(`二维码生成失败：${error.message || "请稍后重试"}`);
    }
    await audit(user, "CREATE_COACH_INVITE", "coachInvite", added._id, { operatorId: user._id, coachId: state.coachId, inviteId: added._id, expiresAt });
    return { inviteId: added._id, coachId: state.coachId, coachProfileId: profile._id, code, scene, qrFileId, expiresAt, status: "ACTIVE" };
  }

  async function preview(input) {
    const invite = await inviteByCredential(input);
    const profile = await profileById(invite.coachProfileId || invite.coachId);
    if (!profile) throw new Error("教练不存在");
    if (!coachActive(profile)) throw new Error("教练已停用");
    const state = await bindingState(profile);
    if (state.bound) throw new Error("该教练账号已经完成绑定，如需更换微信账号请联系俱乐部管理员");
    return { inviteId: invite._id, coachId: state.coachId, coach: { id: profile._id, name: profile.name || "", avatarUrl: profile.avatarUrl || "", publicTitle: profile.publicTitle || "", highestCertificate: profile.highestCertificate || "" }, expiresAt: invite.expiresAt, requiresConfirmation: true };
  }

  async function assignedClassIds(coachId) {
    return (await fetchAll("classes")).filter((item) => (item.headCoachUserId || item.coachUserId) === coachId || (item.assistantCoachIds || []).includes(coachId)).map((item) => item._id);
  }

  async function confirm(input, user, openid) {
    if (!input.confirmed) throw new Error("请先确认这是您的教练账号");
    const invite = await inviteByCredential(input);
    const profile = await profileById(invite.coachProfileId || invite.coachId);
    if (!profile) throw new Error("教练不存在");
    if (!coachActive(profile)) throw new Error("教练已停用");
    const state = await bindingState(profile);
    if (state.bound) throw new Error("该教练账号已经完成绑定，如需更换微信账号请联系俱乐部管理员");
    const currentUser = user || await findUser(openid);
    if (currentUser && !isLegacyPlaceholder(currentUser)) {
      if (currentUser.role === "parent") throw new Error("当前微信账号已经注册为家长账号。如需同时使用教练身份，请联系俱乐部管理员处理。");
      if (currentUser.role === "admin") throw new Error("当前账号已经具有管理员身份，不能通过普通教练邀请直接覆盖角色。");
      if (currentUser.role === "coach") throw new Error("当前微信已经绑定其他教练账号，请联系俱乐部管理员处理。");
      throw new Error("当前微信账号已有其他身份，请联系俱乐部管理员处理");
    }
    const target = (await db.collection("users").doc(state.coachId).get().catch(() => ({ data: null }))).data;
    if (target && target.role === "coach" && target.active !== false && target.openid && target.openid !== openid) throw new Error("该教练账号已经完成绑定，如需更换微信账号请联系俱乐部管理员");
    const classIds = await assignedClassIds(state.coachId), boundAt = nowText();
    await db.runTransaction(async (transaction) => {
      const current = (await transaction.collection("coachInvites").doc(invite._id).get()).data;
      if (!current || current.status !== "ACTIVE" || Number(current.expiresAt || 0) <= Date.now()) throw new Error("该邀请已经失效");
      if (currentUser && isLegacyPlaceholder(currentUser) && currentUser._id !== state.coachId) await transaction.collection("users").doc(currentUser._id).update({ data: { openid: `retired_${identityHash(openid)}`, role: "unregistered", roles: [], status: "DISABLED", active: false, replacedByUserId: state.coachId, updatedAt: boundAt } });
      const userData = { openid, role: "coach", roles: ["coach"], coachId: state.coachId, name: profile.name || "南联教练", status: "ACTIVE", active: true, studentIds: [], classIds: [...new Set([...((target || {}).classIds || []), ...classIds])], profileCompleted: true, authorizationSource: "COACH_INVITE", coachBoundAt: boundAt, updatedAt: boundAt };
      if (target) await transaction.collection("users").doc(state.coachId).update({ data: userData });
      else await transaction.collection("users").doc(state.coachId).set({ data: { ...userData, createdAt: boundAt } });
      await transaction.collection("coachProfiles").doc(profile._id).update({ data: { coachUserId: state.coachId, boundUserId: state.coachId, boundAt, updatedAt: boundAt } });
      await transaction.collection("coachInvites").doc(invite._id).update({ data: { status: "USED", usedByUserId: state.coachId, usedAt: boundAt, updatedAt: boundAt } });
    });
    const boundUser = { _id: state.coachId, role: "coach", coachId: state.coachId, name: profile.name, status: "ACTIVE", active: true };
    await audit(boundUser, "BIND_COACH_ACCOUNT", "coachProfile", profile._id, { operatorId: state.coachId, coachId: state.coachId, userId: state.coachId, inviteId: invite._id });
    return { ok: true, user: { id: state.coachId, role: "coach", coachId: state.coachId, name: profile.name || "南联教练" }, coach: { id: profile._id, name: profile.name || "" }, inviteStatus: "USED" };
  }

  async function cancel(input, user) {
    requireRole(user, ["admin"]);
    const invite = (await db.collection("coachInvites").doc(String(input.inviteId || "")).get().catch(() => ({ data: null }))).data;
    if (!invite) throw new Error("邀请不存在");
    if (invite.status !== "ACTIVE") throw new Error("只有可使用的邀请可以撤销");
    const cancelledAt = nowText();
    await db.collection("coachInvites").doc(invite._id).update({ data: { status: "CANCELLED", cancelledAt, cancelledBy: user._id, updatedAt: cancelledAt } });
    await audit(user, "CANCEL_COACH_INVITE", "coachInvite", invite._id, { operatorId: user._id, coachId: invite.coachId, inviteId: invite._id });
    return { ok: true, status: "CANCELLED" };
  }

  async function unbind(input, user) {
    requireRole(user, ["admin"]);
    if (!input.confirmed) return { confirmationRequired: true, message: "解除后，该教练将无法继续以教练身份登录。历史课程、评价、比赛和教练档案不会删除。是否确认解除绑定？" };
    const profile = await profileById(input.coachId || input.id);
    if (!profile) throw new Error("教练不存在");
    const state = await bindingState(profile);
    if (!state.bound) return { ok: true, unchanged: true };
    const oldUser = state.boundUser, unboundAt = nowText();
    await db.runTransaction(async (transaction) => {
      await transaction.collection("users").doc(oldUser._id).update({ data: { openid: `retired_${identityHash(oldUser.openid)}`, role: "unregistered", roles: [], coachId: "", status: "DISABLED", active: false, unboundCoachId: state.coachId, unboundAt, updatedAt: unboundAt } });
      await transaction.collection("coachProfiles").doc(profile._id).update({ data: { boundUserId: "", boundAt: "", lastUnboundUserId: oldUser._id, lastUnboundAt: unboundAt, updatedAt: unboundAt } });
    });
    await audit(user, "UNBIND_COACH_ACCOUNT", "coachProfile", profile._id, { operatorId: user._id, coachId: state.coachId, userId: oldUser._id, inviteId: "" });
    return { ok: true, coachId: state.coachId, userId: oldUser._id, historyDeleted: false };
  }

  async function setStatus(input, user) {
    requireRole(user, ["admin"]);
    const profile = await profileById(input.coachId || input.id);
    if (!profile) throw new Error("教练不存在");
    const active = input.active === true, updatedAt = nowText(), state = await bindingState(profile);
    await db.collection("coachProfiles").doc(profile._id).update({ data: { active, status: active ? "ACTIVE" : "INACTIVE", updatedAt } });
    if (!active) for (const invite of await fetchAll("coachInvites", { coachId: state.coachId, status: "ACTIVE" })) await db.collection("coachInvites").doc(invite._id).update({ data: { status: "CANCELLED", cancelledAt: updatedAt, cancelledBy: user._id, updatedAt } });
    await audit(user, active ? "REACTIVATE_COACH" : "DEACTIVATE_COACH", "coachProfile", profile._id, { operatorId: user._id, coachId: state.coachId, userId: (state.boundUser || {})._id || "", inviteId: "" });
    return { ok: true, coachId: state.coachId, active, accountStatus: active ? state.bound ? "BOUND" : "UNBOUND" : "INACTIVE" };
  }

  async function assertCoachAccess(user, options = {}) {
    if (!user || user.role !== "coach" || options.allowTestRole) return null;
    const coachId = user.coachId || user._id;
    let profile = (await db.collection("coachProfiles").where({ coachUserId: coachId }).limit(1).get()).data[0];
    if (!profile) profile = (await db.collection("coachProfiles").where({ boundUserId: user._id }).limit(1).get()).data[0];
    if (!profile) { const error = new Error("暂未找到您的教练档案，请联系南联俱乐部管理员完成账号授权"); error.code = "COACH_PROFILE_REQUIRED"; throw error; }
    if (!coachActive(profile)) { const error = new Error("当前教练账号已停用。如有疑问，请联系南联俱乐部管理员。"); error.code = "COACH_INACTIVE"; throw error; }
    if (profile.boundUserId && profile.boundUserId !== user._id) { const error = new Error("当前教练微信绑定已解除，请联系南联俱乐部管理员"); error.code = "COACH_BINDING_REVOKED"; throw error; }
    const updates = {};
    if (!profile.boundUserId && profile.coachUserId === user._id) { updates.boundUserId = user._id; updates.boundAt = profile.boundAt || nowText(); }
    if (user.coachId !== profile.coachUserId) await db.collection("users").doc(user._id).update({ data: { coachId: profile.coachUserId, roles: ["coach"], updatedAt: nowText() } });
    if (options.touch) await db.collection("users").doc(user._id).update({ data: { lastLoginAt: nowText(), updatedAt: nowText() } });
    if (Object.keys(updates).length) await db.collection("coachProfiles").doc(profile._id).update({ data: { ...updates, updatedAt: nowText() } });
    return { profile, coachId: profile.coachUserId, boundUserId: user._id };
  }

  async function call(action, input, user, openid) {
    if (action === "createCoachInvite") return createInvite(input, user);
    if (action === "getCoachInvitePreview") return preview(input);
    if (action === "confirmCoachBinding") return confirm(input, user, openid);
    if (action === "cancelCoachInvite") return cancel(input, user);
    if (action === "unbindCoachAccount") return unbind(input, user);
    if (action === "setCoachStatus") return setStatus(input, user);
    throw new Error("未知教练绑定操作");
  }

  return { handles, publicHandles, call, decorateProfile, assertCoachAccess };
}

module.exports = { ACTIONS, PUBLIC_ACTIONS, digest, coachActive, createCoachBindingService };
