const api = require("../../utils/api");

Page({
  data: { loading: true, error: "", role: "parent", sessions: [], students: [], studentIndex: 0, studentId: "", myClasses: [] },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load(true); },
  async load(refresh = false) {
    if (!refresh) this.setData({ loading: true, error: "" });
    try {
      const [context, students] = await Promise.all([api.call("getContext"), api.call("listStudents")]);
      const remembered = getApp().globalData.activeStudentId || wx.getStorageSync("activeStudentId");
      const studentId = this.data.studentId || (students.some((item) => item.id === remembered) ? remembered : "") || (students[0] && students[0].id) || "";
      const studentIndex = Math.max(0, students.findIndex((item) => item.id === studentId));
      const sessions = await api.call("listSessions", { studentId });
      const selectedStudent = students.find((item) => item.id === studentId) || {};
      this.setData({ role: context.user.role, students, studentIndex, studentId, myClasses: context.user.role === "parent" ? (selectedStudent.classes || []) : [], sessions: sessions.map((item) => ({ ...item, shortDate: String(item.date || "").slice(5), statusLabel: item.myStatus === "booked" ? "正式成员" : item.myStatus === "leave_pending" ? "请假待审批" : item.myStatus === "leave_approved" ? "已请假 · 0课时" : item.myStatus === "leave_rejected" ? "请假被拒绝" : item.statusLabel || "已发布" })), loading: false });
    } catch (error) { this.setData({ loading: false, error: "课程加载失败，请重试" }); }
    finally { wx.stopPullDownRefresh(); }
  },
  studentChange(event) { const index = Number(event.detail.value), id = this.data.students[index].id; getApp().globalData.activeStudentId = id; wx.setStorageSync("activeStudentId", id); this.setData({ studentIndex: index, studentId: id }, () => this.load()); },
  openClass(event) { wx.navigateTo({ url: `/pages/class-detail/index?id=${event.currentTarget.dataset.id}` }); },
  open(event) { wx.navigateTo({ url: `/pages/session-detail/index?id=${event.currentTarget.dataset.id}&studentId=${this.data.studentId}` }); },
  add() { wx.navigateTo({ url: "/pages/session-form/index" }); }
});
