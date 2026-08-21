const api = require("../../utils/api");

Page({
  data: { id: "", studentId: "", role: "parent", session: null, checkinCode: "", checkinInfo: null, openingCheckin: false, checkingIn: false, loading: true, error: "", acting: false, progress: 0 },
  onLoad(options) { this.setData({ id: options.id || "", studentId: options.studentId || "" }); },
  onShow() { if (this.data.id) this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try { const [context, raw] = await Promise.all([api.call("getContext"), api.call("getSession", { id: this.data.id, studentId: this.data.studentId })]); const session = { ...raw, enrollments: (raw.enrollments || []).map((item) => ({ ...item, student: { ...item.student, initial: item.student && item.student.name ? item.student.name[0] : "学" } })) }; const checkinInfo = context.user.role === "parent" ? null : await api.call("getCheckinInfo", { sessionId: this.data.id }); this.setData({ role: context.user.role, session, checkinInfo, checkinCode: checkinInfo && checkinInfo.code || this.data.checkinCode, progress: session.standardCapacity ? Math.min(100, Math.round(session.memberCount / session.standardCapacity * 100)) : 0, loading: false }); }
    catch (error) { this.setData({ loading: false, error: "课程信息加载失败" }); }
  },
  async primary() {
    const session = this.data.session; if (this.data.acting) return;
    if (session.myStatus === "leave_pending") return this.cancelLeave();
    if (session.myStatus === "leave_approved") return wx.showToast({ title: "已请假，本次不扣课时", icon: "none" });
    if (session.myStatus === "leave_rejected") return this.leave();
    if (session.myStatus === "booked") return this.leave();
    this.setData({ acting: true }); try { const result = await api.call("enrollSession", { sessionId: session.id, studentId: this.data.studentId }); wx.showModal({ title: result.status === "full" ? "本班已满" : "报名成功", content: result.message, showCancel: false, success: () => this.load() }); } finally { this.setData({ acting: false }); }
  },
  leave() {
    wx.showModal({ title: "申请请假", editable: true, placeholderText: "请输入请假原因", content: "", success: async (result) => { if (!result.confirm) return; this.setData({ acting: true }); try { await api.call("requestLeave", { sessionId: this.data.id, studentId: this.data.studentId, reason: result.content || "家长请假" }); wx.showModal({ title: "请假申请已提交", content: "等待管理员审批。批准后本节课记为请假且不扣课时。", showCancel: false, success: () => this.load() }); } finally { this.setData({ acting: false }); } } });
  },
  cancelLeave() { wx.showModal({ title: "撤销请假申请", content: "当前申请仍在待审批状态。撤销不会改变课程名单、考勤或课时。", success: async (result) => { if (!result.confirm) return; await api.call("cancelLeave", { id: this.data.session.leaveRequestId }); wx.showToast({ title: "请假已撤销" }); this.load(); } }); },
  attendance() { wx.navigateTo({ url: `/pages/attendance/index?sessionId=${this.data.id}` }); },
  leaves() { wx.navigateTo({ url: "/pages/leave-requests/index" }); },
  edit() { wx.navigateTo({ url: `/pages/session-form/index?id=${this.data.id}` }); },
  location() { return new Promise((resolve, reject) => wx.getLocation({ type: "gcj02", isHighAccuracy: true, success: resolve, fail: reject })); },
  code(event) { this.setData({ checkinCode: event.detail.value }); },
  async openCheckin() { if (this.data.openingCheckin) return; this.setData({ openingCheckin: true }); try { const location = await this.location(); const result = await api.call("openCheckin", { sessionId: this.data.id, latitude: location.latitude, longitude: location.longitude, radius: 300, minutes: 30 }); this.setData({ checkinCode: result.code, checkinInfo: { ...result, open: true } }); wx.showModal({ title: "签到已发布", content: `校验码：${result.code}\n范围：${result.radius}米\n有效期：30分钟`, showCancel: false }); await this.load(); } catch (error) { wx.showToast({ title: error.message || "无法发布签到", icon: "none" }); } finally { this.setData({ openingCheckin: false }); } },
  async closeCheckin() { await api.call("closeCheckin", { sessionId: this.data.id }); wx.showToast({ title: "签到已关闭" }); this.load(); },
  async selfCheckin() { if (this.data.checkingIn || this.data.checkinCode.length !== 6) return wx.showToast({ title: "请输入6位校验码", icon: "none" }); this.setData({ checkingIn: true }); try { const location = await this.location(); const result = await api.call("selfCheckin", { sessionId: this.data.id, studentId: this.data.studentId, code: this.data.checkinCode, latitude: location.latitude, longitude: location.longitude }); wx.showModal({ title: "签到成功", content: `当前位置距签到中心约${result.distance}米`, showCancel: false }); await this.load(); } finally { this.setData({ checkingIn: false }); } }
});
