const api = require("../../utils/api");
const { chooseCoachPhoto } = require("../../utils/coach-photo");

function splitValues(value) { return String(value || "").split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean); }
function inviteView(invite) { if (!invite) return null; const expires = new Date(Number(invite.expiresAt || 0)); return { ...invite, expiresText: Number.isNaN(expires.getTime()) ? "" : `${expires.getFullYear()}-${String(expires.getMonth() + 1).padStart(2, "0")}-${String(expires.getDate()).padStart(2, "0")} ${String(expires.getHours()).padStart(2, "0")}:${String(expires.getMinutes()).padStart(2, "0")}` }; }

Page({
  data: {
    id: "", saving: false, savingAvatar: false, uploading: false, bindingBusy: false, photoDirty: false, originalAvatarUrl: "", previewAvatarUrl: "", shortBioCount: 0, invite: null,
    coach: { avatarUrl: "", name: "", publicTitle: "", coachingYears: 0, highestCertificate: "", shortBio: "", bio: "", trainingPhilosophy: "", internalNote: "", active: true, isPublic: true },
    currentClassesText: "", specialtiesText: "", publicCertificatesText: "", internalCertificatesText: "", careerHistoryText: "", footballHistoryText: "", honorsText: ""
  },
  async onLoad(options) {
    if (!options.id) return;
    this.autoInvite = options.invite === "1";
    await this.loadCoach(options.id);
    if (this.autoInvite && this.data.coach.accountStatus === "UNBOUND") this.createInvite();
  },
  async loadCoach(id) {
    const coach = await api.call("getCoachProfile", { id });
    const publicCertificates = (coach.certificates || []).filter((item) => item.visibility !== "INTERNAL").map((item) => item.name).filter((item) => item !== coach.highestCertificate);
    const internalCertificates = (coach.certificates || []).filter((item) => item.visibility === "INTERNAL").map((item) => item.name);
    this.setData({ id, coach, invite: inviteView(coach.currentInvite), originalAvatarUrl: coach.avatarUrl || "", previewAvatarUrl: coach.avatarUrl || "", shortBioCount: String(coach.shortBio || "").length, currentClassesText: (coach.currentClasses || []).join("、"), specialtiesText: (coach.specialties || []).join("、"), publicCertificatesText: publicCertificates.join("\n"), internalCertificatesText: internalCertificates.join("\n"), careerHistoryText: (coach.careerHistory || []).join("\n"), footballHistoryText: (coach.footballHistory || []).join("\n"), honorsText: (coach.honors || []).join("\n") });
  },
  field(event) { const key = event.currentTarget.dataset.key, value = event.detail.value; this.setData({ [`coach.${key}`]: value, ...(key === "shortBio" ? { shortBioCount: value.length } : {}) }); },
  textField(event) { this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  toggle(event) { this.setData({ [`coach.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  async avatar() {
    if (this.data.uploading) return;
    this.setData({ uploading: true });
    try {
      const avatarUrl = await chooseCoachPhoto();
      if (this.data.id) this.setData({ previewAvatarUrl: avatarUrl, photoDirty: avatarUrl !== this.data.originalAvatarUrl });
      else this.setData({ previewAvatarUrl: avatarUrl, "coach.avatarUrl": avatarUrl });
    } catch (error) { if (!/cancel/i.test(String(error.errMsg || error.message || ""))) wx.showToast({ title: "头像上传失败", icon: "none" }); }
    finally { this.setData({ uploading: false }); }
  },
  previewPhoto() { if (this.data.previewAvatarUrl) wx.previewImage({ current: this.data.previewAvatarUrl, urls: [this.data.previewAvatarUrl] }); },
  cancelAvatar() { this.setData({ previewAvatarUrl: this.data.originalAvatarUrl, photoDirty: false }); },
  async saveAvatar() {
    if (!this.data.id || !this.data.photoDirty || this.data.savingAvatar) return;
    this.setData({ savingAvatar: true });
    try {
      const result = await api.call("updateCoachAvatar", { coachId: this.data.id, avatarUrl: this.data.previewAvatarUrl });
      this.setData({ "coach.avatarUrl": result.avatarUrl, originalAvatarUrl: result.avatarUrl, previewAvatarUrl: result.avatarUrl, photoDirty: false });
      wx.showToast({ title: "教练照片已更新" });
    } catch (error) { wx.showToast({ title: error.message || "照片保存失败", icon: "none" }); }
    finally { this.setData({ savingAvatar: false }); }
  },
  async createInvite() {
    if (!this.data.id || this.data.bindingBusy) return;
    this.setData({ bindingBusy: true });
    try {
      const invite = await api.call("createCoachInvite", { coachId: this.data.id });
      this.setData({ invite: inviteView(invite) });
      wx.showToast({ title: "绑定邀请已生成" });
    } catch (error) { wx.showToast({ title: error.message || "邀请生成失败", icon: "none" }); }
    finally { this.setData({ bindingBusy: false }); }
  },
  previewQr() { if (this.data.invite && this.data.invite.qrFileId) wx.previewImage({ current: this.data.invite.qrFileId, urls: [this.data.invite.qrFileId] }); },
  async cancelInvite() {
    if (!this.data.invite || this.data.bindingBusy) return;
    const modal = await wx.showModal({ title: "撤销绑定邀请", content: "撤销后，二维码和备用码将立即失效。", confirmText: "确认撤销" });
    if (!modal.confirm) return;
    this.setData({ bindingBusy: true });
    try { await api.call("cancelCoachInvite", { inviteId: this.data.invite.inviteId || this.data.invite.id }); this.setData({ invite: null }); wx.showToast({ title: "邀请已撤销" }); }
    finally { this.setData({ bindingBusy: false }); }
  },
  async unbind() {
    const modal = await wx.showModal({ title: "解除教练微信绑定", content: "解除后，该教练将无法继续登录。历史课程、评价、比赛和档案不会删除。", confirmText: "解除绑定", confirmColor: "#b2342d" });
    if (!modal.confirm) return;
    this.setData({ bindingBusy: true });
    try { await api.call("unbindCoachAccount", { coachId: this.data.id, confirmed: true }); await this.loadCoach(this.data.id); wx.showToast({ title: "已解除绑定" }); }
    finally { this.setData({ bindingBusy: false }); }
  },
  async setStatus(event) {
    const active = event.currentTarget.dataset.active === true || event.currentTarget.dataset.active === "true";
    const modal = await wx.showModal({ title: active ? "重新启用教练" : "停用教练", content: active ? "启用后可重新生成绑定邀请并参与排课。" : "停用后将阻止教练登录，并撤销当前未使用邀请；历史数据不会删除。", confirmText: active ? "确认启用" : "确认停用", confirmColor: active ? "#173b77" : "#b2342d" });
    if (!modal.confirm) return;
    this.setData({ bindingBusy: true });
    try { await api.call("setCoachStatus", { coachId: this.data.id, active }); await this.loadCoach(this.data.id); wx.showToast({ title: active ? "已启用" : "已停用" }); }
    finally { this.setData({ bindingBusy: false }); }
  },
  async save() {
    if (this.data.saving) return;
    if (this.data.photoDirty) return wx.showToast({ title: "请先保存或取消照片修改", icon: "none" });
    const coach = { ...this.data.coach, id: this.data.id || undefined, coachingYears: Number(this.data.coach.coachingYears || 0), currentClasses: splitValues(this.data.currentClassesText), specialties: splitValues(this.data.specialtiesText), careerHistory: splitValues(this.data.careerHistoryText), footballHistory: splitValues(this.data.footballHistoryText), honors: splitValues(this.data.honorsText), certificates: [{ name: this.data.coach.highestCertificate, visibility: "PUBLIC", priority: 1 }, ...splitValues(this.data.publicCertificatesText).map((name, index) => ({ name, visibility: "PUBLIC", priority: index + 2 })), ...splitValues(this.data.internalCertificatesText).map((name, index) => ({ name, visibility: "INTERNAL", priority: index + 50 }))] };
    if (!coach.avatarUrl || !coach.name || !coach.publicTitle || !coach.highestCertificate || !coach.shortBio) return wx.showToast({ title: "请完整填写公开资料", icon: "none" });
    this.setData({ saving: true });
    try { await api.call("saveCoachProfile", { coach }); wx.showToast({ title: "教练资料已保存" }); setTimeout(() => wx.navigateBack(), 350); } finally { this.setData({ saving: false }); }
  }
});
