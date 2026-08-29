const ACTIONS = ["listPublicCoaches", "getPublicCoach", "listCoachProfiles", "getCoachProfile", "saveCoachProfile", "updateCoachAvatar"];

const DEMO_COACHES = [
  { seedKey: "coach-profile-you", coachUserId: "coach1", name: "游导", avatarUrl: "/images/nanlian-logo.png", publicTitle: "U8精英队主教练", coachingYears: 10, highestCertificate: "中国足协B级教练员", certificates: [{ name: "中国足协B级教练员", visibility: "PUBLIC", priority: 1 }, { name: "青少年急救培训证", visibility: "PUBLIC", priority: 2 }, { name: "俱乐部内部教研认证", visibility: "INTERNAL", priority: 3 }], currentClasses: ["U8提高班", "U7精英队", "U8精英队"], specialties: ["1V1", "控球", "比赛指导", "梯队建设"], shortBio: "长期从事青少年足球训练，主要负责南联精英梯队培养。注重个人技术、比赛意识和训练兴趣，鼓励孩子在比赛中主动观察和解决问题。", bio: "负责南联青训训练体系与精英梯队建设，长期参与青少年足球训练、赛事组织和升学衔接工作。", careerHistory: ["2016-2020 青少年足球教练", "2021-2025 南联精英梯队主教练", "2026至今 南联青训负责人"], footballHistory: ["长期参加温州地区高水平成人足球赛事"], trainingPhilosophy: "让孩子在真实比赛问题中学会观察、判断和行动。", honors: ["带队参加浙江省青少年足球联赛"], internalNote: "头牌全职教练，内部薪资与绩效信息不得公开。", active: true, isPublic: true },
  { seedKey: "coach-profile-wang", coachUserId: "coach2", name: "王蒋生", avatarUrl: "/images/avatar.png", publicTitle: "基础班主教练", coachingYears: 6, highestCertificate: "中国足协D级教练员", certificates: [{ name: "中国足协D级教练员", visibility: "PUBLIC", priority: 1 }], currentClasses: ["U6启蒙班", "U7基础班"], specialties: ["足球启蒙", "球感训练", "兴趣培养"], shortBio: "主要负责幼儿及小学阶段基础训练，重视球感、协调性和训练兴趣，用清晰、有耐心的方式帮助孩子建立足球基本能力。", bio: "长期参与幼儿和小学年龄段足球启蒙工作。", careerHistory: ["2020至今 南联基础班教练"], footballHistory: [], trainingPhilosophy: "先让孩子喜欢足球，再帮助孩子掌握足球。", honors: [], internalNote: "兼职教练资料，证书有效期需由管理员定期核验。", active: true, isPublic: true },
  { seedKey: "coach-profile-chen", coachUserId: "coach3", name: "陈教练", avatarUrl: "/images/avatar.png", publicTitle: "青训教练", coachingYears: 5, highestCertificate: "中国足协D级教练员", certificates: [{ name: "中国足协D级教练员", visibility: "PUBLIC", priority: 1 }], currentClasses: ["U8基础班"], specialties: ["传接球", "协调性", "小组配合"], shortBio: "专注小学年龄段足球训练，重视基本技术和小组配合，帮助孩子在稳定、积极的训练环境中建立信心。", active: true, isPublic: true },
  { seedKey: "coach-profile-wu", coachUserId: "coach4", name: "吴教练", avatarUrl: "/images/avatar.png", publicTitle: "青训教练", coachingYears: 4, highestCertificate: "中国足协D级教练员", certificates: [{ name: "中国足协D级教练员", visibility: "PUBLIC", priority: 1 }], currentClasses: ["兴趣班"], specialties: ["足球启蒙", "控球", "比赛指导"], shortBio: "主要参与启蒙与基础阶段训练，关注孩子的训练参与感，通过游戏和比赛帮助孩子理解足球。", active: true, isPublic: true }
];

function strings(value) { if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean); return String(value || "").split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean); }
function publicCertificates(profile) { const names = (profile.certificates || []).filter((item) => typeof item === "string" || item.visibility !== "INTERNAL").sort((a, b) => Number((a || {}).priority || 99) - Number((b || {}).priority || 99)).map((item) => typeof item === "string" ? item : item.name).filter(Boolean); return [...new Set([profile.highestCertificate, ...names].filter(Boolean))]; }
function publicView(profile) { if (!profile || profile.active === false || profile.isPublic === false) return null; return { coachId: profile._id, name: String(profile.name || ""), avatarUrl: String(profile.avatarUrl || ""), publicTitle: String(profile.publicTitle || ""), coachingYears: Math.max(0, Number(profile.coachingYears || 0)), highestCertificate: String(profile.highestCertificate || ""), mainCertificates: publicCertificates(profile), currentClasses: strings(profile.currentClasses), specialties: strings(profile.specialties).slice(0, 3), shortBio: String(profile.shortBio || "").slice(0, 120) }; }

function createCoachService({ db, fetchAll, nowText, requireRole, audit, getBindingView }) {
  let defaultsReady;
  const handles = (action) => ACTIONS.includes(action);
  async function ensureDefaults() {
    if (!defaultsReady) defaultsReady = (async () => {
      for (const item of DEMO_COACHES) {
        const found = await db.collection("coachProfiles").where({ seedKey: item.seedKey }).limit(1).get();
        if (!found.data.length) await db.collection("coachProfiles").add({ data: { ...item, createdAt: nowText(), updatedAt: nowText() } });
      }
    })();
    return defaultsReady;
  }
  function normalizeProfile(profile, previous) {
    const shortBio = String(profile.shortBio || "").trim();
    const avatarUrl = String(profile.avatarUrl || "").trim();
    if (shortBio.length > 120) throw new Error("家长端简短介绍不能超过120字");
    if (/^data:image\//i.test(avatarUrl)) throw new Error("教练照片不能使用base64保存");
    const name = String(profile.name || "").trim(), publicTitle = String(profile.publicTitle || "").trim(), highestCertificate = String(profile.highestCertificate || "").trim();
    if (!name || !publicTitle || !highestCertificate) throw new Error("请完整填写家长公开资料");
    const certificates = (profile.certificates || []).map((item, index) => ({ name: String(typeof item === "string" ? item : item.name || "").trim(), visibility: typeof item === "string" ? "PUBLIC" : item.visibility === "INTERNAL" ? "INTERNAL" : "PUBLIC", priority: Number((item || {}).priority || index + 1) })).filter((item) => item.name);
    const protectedFields = { coachUserId: previous.coachUserId || "", boundUserId: previous.boundUserId || "", boundAt: previous.boundAt || "", active: previous._id ? previous.active !== false : true, status: previous._id ? previous.status || "ACTIVE" : "ACTIVE" };
    return { ...previous, ...profile, ...protectedFields, name, avatarUrl, publicTitle, coachingYears: Math.max(0, Number(profile.coachingYears || 0)), highestCertificate, certificates, currentClasses: strings(profile.currentClasses), specialties: strings(profile.specialties), shortBio, bio: String(profile.bio || "").trim(), careerHistory: strings(profile.careerHistory), footballHistory: strings(profile.footballHistory), trainingPhilosophy: String(profile.trainingPhilosophy || "").trim(), honors: strings(profile.honors), internalNote: String(profile.internalNote || "").trim(), isPublic: profile.isPublic !== false, updatedAt: nowText() };
  }
  async function adminView(profile) { return { ...profile, ...(getBindingView ? await getBindingView(profile) : {}), id: profile._id, _id: undefined }; }
  async function findProfile(value) {
    const direct = (await db.collection("coachProfiles").doc(String(value || "")).get().catch(() => ({ data: null }))).data;
    return direct || (await db.collection("coachProfiles").where({ coachUserId: String(value || "") }).limit(1).get()).data[0] || null;
  }
  async function getReference(coachUserId, coachName) {
    let profile;
    if (coachUserId) profile = (await db.collection("coachProfiles").where({ coachUserId }).limit(10).get()).data.find((item) => item.active !== false && item.isPublic !== false);
    if (!profile && coachName) profile = (await db.collection("coachProfiles").where({ name: coachName }).limit(10).get()).data.find((item) => item.active !== false && item.isPublic !== false);
    return { coachId: profile ? profile._id : "", name: String(coachName || (profile || {}).name || ""), avatarUrl: String((profile || {}).avatarUrl || "") };
  }
  async function call(action, input, user) {
    await ensureDefaults();
    if (action === "listPublicCoaches") return (await fetchAll("coachProfiles")).map(publicView).filter(Boolean);
    if (action === "getPublicCoach") { const profile = (await db.collection("coachProfiles").doc(input.id).get().catch(() => ({ data: null }))).data, result = publicView(profile); if (!result) throw new Error("教练资料不存在或未公开"); return result; }
    if (action === "listCoachProfiles") { requireRole(user, ["admin"]); const rows = []; for (const item of await fetchAll("coachProfiles")) rows.push(await adminView(item)); return rows; }
    if (action === "getCoachProfile") { requireRole(user, ["admin"]); const profile = await findProfile(input.id); if (!profile) throw new Error("教练资料不存在"); return adminView(profile); }
    if (action === "saveCoachProfile") {
      requireRole(user, ["admin"]); const incoming = input.coach || {}; let id = incoming.id, previous = {};
      if (id) { previous = (await db.collection("coachProfiles").doc(id).get()).data; if (!previous) throw new Error("教练资料不存在"); }
      const normalized = normalizeProfile(incoming, previous || {}); delete normalized.id; delete normalized._id;
      if (id) await db.collection("coachProfiles").doc(id).update({ data: normalized }); else { const added = await db.collection("coachProfiles").add({ data: { ...normalized, createdAt: nowText() } }); id = added._id; await db.collection("coachProfiles").doc(id).update({ data: { coachUserId: `coach_${id}`, updatedAt: nowText() } }); }
      await audit(user, "SAVE_COACH_PROFILE", "coachProfile", id, { isPublic: normalized.isPublic }); return { id };
    }
    if (action === "updateCoachAvatar") {
      requireRole(user, ["admin"]); const coachId = String(input.coachId || ""), newAvatarUrl = String(input.avatarUrl || "").trim();
      if (!coachId) throw new Error("教练资料不存在"); if (!newAvatarUrl || /^data:image\//i.test(newAvatarUrl)) throw new Error("教练照片地址无效");
      const profile = (await db.collection("coachProfiles").doc(coachId).get()).data; if (!profile) throw new Error("教练资料不存在"); const oldAvatarUrl = String(profile.avatarUrl || "");
      if (oldAvatarUrl === newAvatarUrl) return { coachId, avatarUrl: newAvatarUrl, unchanged: true };
      await db.collection("coachProfiles").doc(coachId).update({ data: { avatarUrl: newAvatarUrl, updatedAt: nowText() } });
      await audit(user, "UPDATE_COACH_AVATAR", "coachProfile", coachId, { coachId, operatorId: user._id, oldAvatarUrl, newAvatarUrl });
      return { coachId, avatarUrl: newAvatarUrl, unchanged: false };
    }
    throw new Error("未知教练资料操作");
  }
  return { handles, ensureDefaults, getReference, call };
}

module.exports = { ACTIONS, DEMO_COACHES, publicView, createCoachService };
