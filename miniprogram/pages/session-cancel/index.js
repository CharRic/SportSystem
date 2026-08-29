const api = require("../../utils/api");

Page({
  data: {
    id: "", session: null, reasons: [
      { value: "WEATHER", label: "天气原因" }, { value: "VENUE", label: "场地原因" }, { value: "COACH", label: "教练原因" },
      { value: "CLUB", label: "俱乐部原因" }, { value: "FORCE_MAJEURE", label: "不可抗力" }, { value: "OTHER", label: "其他" }
    ], reasonIndex: 0, compensations: [
      { value: "EXTEND_VALIDITY", label: "有效期顺延" }, { value: "MAKEUP_SESSION", label: "安排补课" }, { value: "NO_COMPENSATION", label: "不补偿" }
    ], compensationIndex: 0, replacements: [], replacementIndex: 0, reason: "", extensionDays: 7, saving: false, loading: true
  },
  onLoad(options) { this.setData({ id: options.id || "" }); },
  onShow() { if (this.data.id) this.load(); },
  async load() { const [context, session, sessions] = await Promise.all([api.call("getContext"), api.call("getSession", { id: this.data.id }), api.call("listSessions")]); if (context.user.role !== "admin") throw new Error("仅管理员可以取消课程"); const replacements = sessions.filter((item) => item.id !== session.id && item.classId === session.classId && item.status !== "CANCELLED").map((item) => ({ ...item, displayName: `${item.date} ${item.time} · ${item.venue}` })); this.setData({ session, replacements, loading: false }); },
  reasonChange(event) { const reasonIndex = Number(event.detail.value), value = this.data.reasons[reasonIndex].value, compensationIndex = ["WEATHER", "VENUE", "CLUB"].includes(value) ? 0 : 2; this.setData({ reasonIndex, compensationIndex }); },
  compensationChange(event) { this.setData({ compensationIndex: Number(event.detail.value) }); }, replacementChange(event) { this.setData({ replacementIndex: Number(event.detail.value) }); },
  reasonInput(event) { this.setData({ reason: event.detail.value }); }, daysInput(event) { this.setData({ extensionDays: event.detail.value }); },
  async submit() { const reason = this.data.reasons[this.data.reasonIndex], compensation = this.data.compensations[this.data.compensationIndex], replacement = this.data.replacements[this.data.replacementIndex]; if (compensation.value === "MAKEUP_SESSION" && !replacement) return wx.showToast({ title: "请选择补课课程", icon: "none" }); const extensionDays = Number(this.data.extensionDays || 0); if (compensation.value === "EXTEND_VALIDITY" && (!Number.isInteger(extensionDays) || extensionDays <= 0)) return wx.showToast({ title: "请输入顺延天数", icon: "none" }); this.setData({ saving: true }); try { const result = await api.call("cancelSession", { sessionId: this.data.id, reasonCode: reason.value, reason: this.data.reason || reason.label, compensationType: compensation.value, extensionDays, replacementSessionId: replacement ? replacement.id : "" }); wx.showModal({ title: "课程已取消", content: `影响正式成员：${result.affectedCount || 0}人\n补偿方式：${compensation.label}${compensation.value === "EXTEND_VALIDITY" ? ` ${extensionDays}天` : ""}`, showCancel: false, success: () => wx.navigateBack() }); } finally { this.setData({ saving: false }); } }
});
