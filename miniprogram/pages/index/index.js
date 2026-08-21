const api = require("../../utils/api");
const { roleLabels, today } = require("../../utils/format");

Page({
  data: { loading: true, error: "", dashboard: {}, user: {}, roleLabel: "", today: today(), attentionTitle: "重点关注" },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load(true); },
  async load(fromRefresh = false) {
    if (!fromRefresh) this.setData({ loading: true, error: "" });
    try {
      const context = await api.call("getContext");
      let family = { students: [], activeStudentId: "" };
      if (context.user.role === "parent") family = await api.call("getFamilyContext", { activeStudentId: getApp().globalData.activeStudentId });
      const activeStudentId = family.activeStudentId || "";
      if (activeStudentId) { getApp().globalData.activeStudentId = activeStudentId; wx.setStorageSync("activeStudentId", activeStudentId); }
      const dashboard = await api.call("getDashboard", { activeStudentId });
      this.setData({
        user: context.user,
        dashboard: { ...dashboard, recentStudents: (dashboard.recentStudents || []).map((item) => ({ ...item, lowBalance: Number(item.remainingLessons) <= 5 })) },
        roleLabel: roleLabels[context.user.role],
        attentionTitle: dashboard.lowBalance ? "低课时提醒" : "学员概览",
        familyStudents: family.students,
        activeStudentId,
        activeStudentIndex: Math.max(0, family.students.findIndex((item) => item.id === activeStudentId)),
        loading: false,
        error: ""
      });
    } catch (error) {
      this.setData({ loading: false, error: "数据加载失败，请检查网络后重试" });
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  activeStudentChange(event) { const index = Number(event.detail.value), student = this.data.familyStudents[index]; if (!student) return; getApp().globalData.activeStudentId = student.id; wx.setStorageSync("activeStudentId", student.id); this.setData({ activeStudentIndex: index, activeStudentId: student.id }, () => this.load()); },
  goStudents() { wx.switchTab({ url: "/pages/students/index" }); },
  goClasses() { wx.navigateTo({ url: "/pages/classes/index" }); },
  goSessions() { wx.switchTab({ url: "/pages/sessions/index" }); },
  goLeaves() { wx.navigateTo({ url: "/pages/leave-requests/index" }); },
  goOperations() { wx.navigateTo({ url: "/pages/operations/index" }); },
  goNews() { wx.navigateTo({ url: "/pages/news/index" }); },
  goRenewals() { wx.navigateTo({ url: "/pages/orders/index" }); },
  goStat4() { if (this.data.dashboard.role === "coach") this.goClasses(); else this.goRenewals(); },
  goStudent(event) { wx.navigateTo({ url: `/pages/student-detail/index?id=${event.currentTarget.dataset.id}` }); },
  takeAttendance(event) { wx.navigateTo({ url: `/pages/attendance/index?sessionId=${event.currentTarget.dataset.id}` }); }
});
