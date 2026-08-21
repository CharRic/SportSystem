const api = require("../../utils/api");
const { attendanceLabels } = require("../../utils/format");
const { chooseStudentPhoto } = require("../../utils/student-photo");

Page({
  data: { id: "", student: null, role: "admin", mode: "local", loading: true, error: "", inviting: false, uploadingPhoto: false, attendanceLabels },
  onLoad(options) { this.setData({ id: options.id }); },
  onShow() { if (this.data.id) this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [context, student] = await Promise.all([api.call("getContext"), api.call("getStudent", { id: this.data.id })]);
      student.initial = student.name ? student.name[0] : "学";
      student.attendance = student.attendance.map((item) => ({ ...item, statusLabel: attendanceLabels[item.status] }));
      this.setData({ student: { ...student, lowBalance: Number(student.remainingLessons) <= 5 }, role: context.user.role, mode: context.mode, loading: false });
    } catch (error) { this.setData({ loading: false, error: "学员详情加载失败" }); }
  },
  edit() { wx.navigateTo({ url: `/pages/student-form/index?id=${this.data.id}` }); },
  renew() { wx.navigateTo({ url: `/pages/orders/index?studentId=${this.data.id}` }); },
  privateProfile() { wx.navigateTo({ url: `/pages/student-private-profile/index?studentId=${this.data.id}&name=${this.data.student.name}` }); },
  transferParent() { wx.navigateTo({ url: `/pages/student-parent-transfer/index?studentId=${this.data.id}` }); },
  async replacePhoto() {
    if (!["admin", "parent"].includes(this.data.role) || this.data.uploadingPhoto) return;
    this.setData({ uploadingPhoto: true });
    try {
      const avatarUrl = await chooseStudentPhoto();
      await api.call("updateStudentAvatar", { studentId: this.data.id, avatarUrl });
      this.setData({ "student.avatarUrl": avatarUrl });
      wx.showToast({ title: "孩子照片已更新" });
    } catch (error) { if (!/cancel/i.test(String(error.errMsg || error.message || ""))) wx.showToast({ title: error.message || "照片更新失败", icon: "none" }); }
    finally { this.setData({ uploadingPhoto: false }); }
  },
  async parentInvite() {
    if (this.data.inviting) return;
    this.setData({ inviting: true });
    try {
      const result = await api.call("createInvite", { role: "parent", studentId: this.data.id, displayName: this.data.student.guardianName });
      wx.showModal({ title: "家长绑定邀请码", content: `${result.code}\n\n请家长在“我的”页面输入。邀请码使用一次后失效。`, showCancel: false, confirmText: "知道了" });
    } finally { this.setData({ inviting: false }); }
  }
});
