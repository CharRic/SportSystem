const api = require("../../utils/api");

Page({
  data: { id: "", clubClass: null, role: "parent", students: [], studentIndex: 0, loading: true, error: "", includeInactive: false, exitReasons: ["年龄升级", "调整梯队", "训练表现", "长期缺勤", "转会/离队", "其他"] },
  onLoad(options) { this.setData({ id: options.id || "" }); },
  onShow() { if (this.data.id) this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try { const [context, clubClass, students] = await Promise.all([api.call("getContext"), api.call("getClassDetail", { id: this.data.id, includeInactive: this.data.includeInactive }), api.call("listStudents")]); this.setData({ role: context.user.role, clubClass, students, loading: false }); }
    catch (error) { this.setData({ loading: false, error: "班级详情加载失败" }); }
  },
  toggleHistory(event) { this.setData({ includeInactive: event.detail.value }, () => this.load()); },
  add() { wx.navigateTo({ url: `/pages/class-member-add/index?classId=${this.data.id}` }); },
  edit() { wx.navigateTo({ url: `/pages/class-form/index?id=${this.data.id}` }); },
  studentChange(event) { this.setData({ studentIndex: Number(event.detail.value) }); },
  async join() { const student = this.data.students[this.data.studentIndex] || {}; const result = await api.call("joinClass", { classId: this.data.id, studentId: student.id }); wx.showModal({ title: result.status === "FULL" ? "本班已满" : "报名成功", content: result.message, showCancel: false, success: () => this.load() }); },
  transfer(event) { wx.navigateTo({ url: `/pages/class-member-transfer/index?memberId=${event.currentTarget.dataset.member}&classId=${this.data.id}` }); },
  student(event) { wx.navigateTo({ url: `/pages/student-detail/index?id=${event.currentTarget.dataset.student}` }); },
  remove(event) {
    const memberId = event.currentTarget.dataset.member;
    wx.showActionSheet({ itemList: this.data.exitReasons, success: async (result) => { const reason = this.data.exitReasons[result.tapIndex]; await api.call("removeClassMember", { memberId, reason }); wx.showToast({ title: "已移出" }); this.load(); } });
  }
});
