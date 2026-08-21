const api = require("../../utils/api");
const { today } = require("../../utils/format");

Page({
  data: { sessionId: "", date: today(), today: today(), session: {}, students: [], saving: false, loading: true, error: "", dirty: false, summary: { marked: 0, unmarked: 0, present: 0, leave: 0, sick: 0, absent: 0 }, statuses: [
    { value: "present", label: "到课" }, { value: "leave", label: "请假" }, { value: "sick", label: "伤病" }, { value: "absent", label: "缺勤" }
  ] },
  onLoad(options) { this.setData({ sessionId: options.sessionId || "" }); this.load(); },
  async load() {
    if (!this.data.sessionId) { this.setData({ loading: false, error: "缺少课程信息，请返回重试" }); return; }
    this.setData({ loading: true, error: "" });
    try {
      const sheet = await api.call("getAttendanceSheet", { sessionId: this.data.sessionId });
      this.applyStudents(sheet.students, false, { session: sheet.session, date: sheet.date, loading: false });
    } catch (error) { this.setData({ loading: false, error: "点名表加载失败" }); }
  },
  date(event) {
    const nextDate = event.detail.value;
    if (!this.data.dirty) { this.setData({ date: nextDate }, () => this.load()); return; }
    wx.showModal({ title: "切换日期？", content: "当前点名尚未保存，切换后本次选择会丢失。", success: (result) => {
      if (result.confirm) { this.clearDirty(); this.setData({ date: nextDate }, () => this.load()); }
    } });
  },
  applyStudents(students, dirty, extra = {}) {
    const summary = { marked: 0, unmarked: 0, present: 0, leave: 0, sick: 0, absent: 0 };
    students.forEach((item) => {
      const status = item.attendanceStatus || "unmarked";
      if (status === "unmarked") summary.unmarked += 1;
      else { summary.marked += 1; summary[status] += 1; }
    });
    this.setData({ students, summary, dirty, ...extra });
    if (dirty) this.enableDirtyWarning();
  },
  enableDirtyWarning() {
    if (!wx.enableAlertBeforeUnload) return;
    try { wx.enableAlertBeforeUnload({ message: "点名尚未保存，确定离开吗？" }); } catch (error) { /* 低版本忽略 */ }
  },
  clearDirty() {
    if (wx.disableAlertBeforeUnload) {
      try { wx.disableAlertBeforeUnload(); } catch (error) { /* 低版本忽略 */ }
    }
    this.setData({ dirty: false });
  },
  status(event) {
    const { student, status } = event.currentTarget.dataset;
    const students = this.data.students.map((item) => item.id === student ? { ...item, attendanceStatus: status } : item);
    this.applyStudents(students, true);
  },
  unlock(event) {
    const studentId = event.currentTarget.dataset.student;
    wx.showModal({ title: "修改已批准请假状态", content: "该学员已批准请假且本次不扣课。继续修改会重新计算课时并写入审计日志。", confirmText: "继续修改", success: (result) => { if (!result.confirm) return; const students = this.data.students.map((item) => item.id === studentId ? { ...item, leaveLocked: false, leaveOverride: true } : item); this.setData({ students }); } });
  },
  allPresent() { if (this.data.students.length) this.applyStudents(this.data.students.map((item) => item.leaveLocked ? item : ({ ...item, attendanceStatus: "present" })), true); },
  async submit() {
    if (this.data.saving || !this.data.students.length) return;
    if (this.data.summary.unmarked) { wx.showToast({ title: `还有${this.data.summary.unmarked}人未点名`, icon: "none" }); return; }
    this.setData({ saving: true });
    try {
      await api.call("submitAttendance", { sessionId: this.data.sessionId, records: this.data.students.map((item) => ({ studentId: item.id, status: item.attendanceStatus, overrideApprovedLeave: Boolean(item.leaveOverride) })) });
      this.clearDirty();
      wx.showToast({ title: "点名已保存" });
    } finally { this.setData({ saving: false }); }
  }
});
