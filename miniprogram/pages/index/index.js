const api = require("../../utils/api");
const { roleLabels, today } = require("../../utils/format");

Page({
  data: { loading: true, error: "", dashboard: {}, user: {}, roleLabel: "", familyStudents: [], parentEmpty: false, today: today(), attentionTitle: "重点关注", nextSchedule: null, todayScheduleStats: { total: 0, inProgress: 0, upcoming: 0 } },
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
      let timetable = { items: [] };
      try {
        timetable = await api.call("getUnifiedTimetable", { date: today(), studentId: activeStudentId || undefined });
      } catch (error) {
        console.warn("统一课表暂不可用，首页继续使用基础数据", error);
      }
      const nextSchedule = (timetable.items || []).find((item) => item.date >= today()) || null;
      const todayItems = (timetable.items || []).filter((item) => item.sourceType === "TRAINING" && item.date === today()), todayScheduleStats = { total: todayItems.length, inProgress: todayItems.filter((item) => item.status === "IN_PROGRESS").length, upcoming: todayItems.filter((item) => !["IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(item.status)).length };
      this.setData({
        user: context.user,
        dashboard: { ...dashboard, recentStudents: (dashboard.recentStudents || []).map((item) => ({ ...item, lowBalance: Number(item.remainingLessons) <= 5 })) },
        roleLabel: roleLabels[context.user.role],
        attentionTitle: dashboard.lowBalance ? "低课时提醒" : "学员概览",
        familyStudents: family.students,
        activeStudentId,
        activeStudentIndex: Math.max(0, family.students.findIndex((item) => item.id === activeStudentId)),
        parentEmpty: context.user.role === "parent" && family.students.length === 0,
        nextSchedule,
        todayScheduleStats,
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
  goAddChild() { wx.navigateTo({ url: "/pages/parent-child-form/index" }); },
  goStudents() { wx.switchTab({ url: "/pages/students/index" }); },
  goClasses() { wx.navigateTo({ url: "/pages/classes/index" }); },
  goCoachTeam() { wx.navigateTo({ url: "/pages/coach-team/index" }); },
  goSessions() { wx.switchTab({ url: "/pages/sessions/index" }); },
  goLeaves() { wx.navigateTo({ url: "/pages/leave-requests/index" }); },
  goOperations() { wx.navigateTo({ url: "/pages/operations/index" }); },
  goCoachWorkbench() { wx.navigateTo({ url: "/pages/coach-workbench/index" }); },
  goCrm() { wx.navigateTo({ url: "/pages/crm-dashboard/index" }); },
  goTraining() { wx.navigateTo({ url: "/pages/research-center/index" }); },
  goCurriculums() { wx.navigateTo({ url: "/pages/curriculums/index" }); },
  goWeeklyPlans() { wx.navigateTo({ url: "/pages/training-cycles/index" }); },
  goGrowth() { const id = this.data.activeStudentId || ((this.data.dashboard.recentStudents || [])[0] || {}).id || ""; if (this.data.user.role === "parent" && id) wx.navigateTo({ url: `/pages/growth-profile/index?studentId=${id}` }); else if (this.data.user.role === "parent") wx.showToast({ title: "请先添加孩子", icon: "none" }); else wx.navigateTo({ url: "/pages/assessment-rounds/index" }); },
  goElite() { wx.navigateTo({ url: "/pages/elite-selections/index" }); },
  goLeague() { wx.navigateTo({ url: "/pages/league-dashboard/index" }); },
  goTimetable() { const role = this.data.user.role; wx.navigateTo({ url: role === "admin" ? "/pages/coach-schedule/index" : role === "coach" ? "/pages/coach-workbench/index" : "/pages/family-timetable/index" }); },
  openNext() { const item = this.data.nextSchedule; if (item && item.sourceType === "TRAINING") wx.navigateTo({ url: `/pages/session-detail/index?id=${item.sessionId}&studentId=${item.studentId || ""}` }); else this.goTimetable(); },
  goNews() { wx.navigateTo({ url: "/pages/news/index" }); },
  goRenewals() { wx.navigateTo({ url: "/pages/orders/index" }); },
  goStat4() { if (this.data.dashboard.role === "coach") this.goClasses(); else this.goRenewals(); },
  goStudent(event) { wx.navigateTo({ url: `/pages/student-detail/index?id=${event.currentTarget.dataset.id}` }); },
  takeAttendance(event) { wx.navigateTo({ url: `/pages/attendance/index?sessionId=${event.currentTarget.dataset.id}` }); }
});
