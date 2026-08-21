const api = require("../../utils/api");

Page({
  data: { memberId: "", sourceClassId: "", classes: [], classIndex: 0, keepSource: false, reason: "调整梯队", saving: false, loading: true },
  async onLoad(options) { const meta = await api.call("getClassMeta"); const classes = (meta.regularClasses || []).filter((item) => item.id !== options.classId); this.setData({ memberId: options.memberId || "", sourceClassId: options.classId || "", classes, loading: false }); },
  classChange(event) { this.setData({ classIndex: Number(event.detail.value) }); }, keep(event) { this.setData({ keepSource: event.detail.value }); }, field(event) { this.setData({ reason: event.detail.value }); },
  submit() { this.transfer(false); },
  async transfer(confirmCapacity) { const target = this.data.classes[this.data.classIndex]; if (!target || this.data.saving) return; this.setData({ saving: true }); try { const result = await api.call("transferClassMember", { memberId: this.data.memberId, targetClassId: target.id, keepSource: this.data.keepSource, reason: this.data.reason || "调整梯队", confirmCapacity }); if (result.requiresConfirmation) return wx.showModal({ title: "超出标准容量", content: result.message, confirmText: "确认转入", success: (modal) => { if (modal.confirm) this.transfer(true); } }); wx.showToast({ title: "调整完成" }); setTimeout(() => wx.navigateBack(), 350); } finally { this.setData({ saving: false }); } }
});
