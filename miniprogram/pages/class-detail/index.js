const api = require("../../utils/api");

Page({
  data: { id: "", clubClass: null, trainingOverview: null, role: "parent", students: [], studentIndex: 0, joined: false, ownStudentIds: [], loading: true, error: "", includeInactive: false, exitReasons: ["年龄升级", "调整梯队", "训练表现", "长期缺勤", "转会/离队", "其他"] },
  onLoad(options) { this.setData({ id: options.id || "" }); },
  onShow() { if (this.data.id) this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [context, students] = await Promise.all([api.call("getContext"), api.call("listStudents")]);
      const joinedStudents = context.user.role === "parent" ? students.filter((student) => (student.classIds || []).includes(this.data.id)) : [];
      const clubClass = await api.call(context.user.role === "parent" && joinedStudents.length ? "getParentClassDetail" : "getClassDetail", { id: this.data.id, includeInactive: this.data.includeInactive });
      const trainingOverview = context.user.role === "parent" && joinedStudents.length ? await api.call("getParentClassTrainingOverview", { classId: this.data.id, studentId: joinedStudents[0].id }) : null;
      const ownStudentIds = students.map((student) => student.id);
      clubClass.classmates = (clubClass.classmates || []).map((item) => ({ ...item, initial: (item.displayName || "学")[0], isMine: ownStudentIds.includes(item.studentId) }));
      const studentIndex = joinedStudents.length ? Math.max(0, students.findIndex((student) => student.id === joinedStudents[0].id)) : this.data.studentIndex;
      this.setData({ role: context.user.role, clubClass, trainingOverview, students, studentIndex, joined: joinedStudents.length > 0, ownStudentIds, loading: false });
    }
    catch (error) { this.setData({ loading: false, error: "班级详情加载失败" }); }
  },
  toggleHistory(event) { this.setData({ includeInactive: event.detail.value }, () => this.load()); },
  add() { wx.navigateTo({ url: `/pages/class-member-add/index?classId=${this.data.id}` }); },
  edit() { wx.navigateTo({ url: `/pages/class-form/index?id=${this.data.id}` }); },
  selections() { wx.navigateTo({ url: `/pages/elite-selections/index?classId=${this.data.id}` }); },
  studentChange(event) { this.setData({ studentIndex: Number(event.detail.value) }); },
  async join() {
    const student = this.data.students[this.data.studentIndex] || {};
    const result = await api.call("joinClass", { classId: this.data.id, studentId: student.id });
    if (result.status === "FULL") { wx.showModal({ title: "本班已满", content: result.message, showCancel: false }); return; }
    wx.showModal({
      title: result.duplicate ? "已加入班级" : "报名成功",
      content: `${student.name}已加入：\n${this.data.clubClass.name}\n\n班级关系已生效，训练安排发布后会自动显示在“我的课表”。`,
      confirmText: "查看班级详情",
      cancelText: "查看课表",
      success: (modal) => {
        if (modal.confirm) this.load();
        else if (modal.cancel) wx.navigateTo({ url: "/pages/family-timetable/index" });
      }
    });
  },
  coach(event) { const id = event.currentTarget.dataset.id; if (id) wx.navigateTo({ url: `/pages/coach-detail/index?id=${id}` }); },
  classmate(event) { const id = event.currentTarget.dataset.id, value = event.currentTarget.dataset.mine, mine = value === true || value === "true"; if (mine) wx.navigateTo({ url: `/pages/student-detail/index?id=${id}` }); },
  transfer(event) { wx.navigateTo({ url: `/pages/class-member-transfer/index?memberId=${event.currentTarget.dataset.member}&classId=${this.data.id}` }); },
  elite(event) { wx.navigateTo({ url: `/pages/elite-action/index?studentId=${event.currentTarget.dataset.student}&fromClassId=${this.data.id}` }); },
  student(event) { wx.navigateTo({ url: `/pages/student-detail/index?id=${event.currentTarget.dataset.student}` }); },
  remove(event) {
    const memberId = event.currentTarget.dataset.member;
    wx.showActionSheet({ itemList: this.data.exitReasons, success: async (result) => { const reason = this.data.exitReasons[result.tapIndex]; await api.call("removeClassMember", { memberId, reason }); wx.showToast({ title: "已移出" }); this.load(); } });
  }
});
