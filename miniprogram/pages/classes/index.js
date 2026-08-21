const api = require("../../utils/api");
const { today } = require("../../utils/format");

Page({
  data: { classes: [], role: "admin", mode: "local", keyword: "", today: today(), loading: true, error: "", invitingId: "" },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load(true); },
  async load(fromRefresh = false) {
    if (!fromRefresh) this.setData({ loading: true, error: "" });
    try {
      const [context, classes] = await Promise.all([api.call("getContext"), api.call("listClasses", { keyword: this.data.keyword })]);
      this.setData({ classes, role: context.user.role, mode: context.mode, loading: false, error: "" });
    } catch (error) { this.setData({ loading: false, error: "班级数据加载失败" }); }
    finally { wx.stopPullDownRefresh(); }
  },
  attendance() { wx.switchTab({ url: "/pages/sessions/index" }); },
  keyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(); },
  open(event) { wx.navigateTo({ url: `/pages/class-detail/index?id=${event.currentTarget.dataset.id}` }); },
  add() { wx.navigateTo({ url: "/pages/class-form/index" }); },
  edit(event) { wx.navigateTo({ url: `/pages/class-form/index?id=${event.currentTarget.dataset.id}` }); },
  async coachInvite(event) {
    const item = this.data.classes.find((clubClass) => clubClass.id === event.currentTarget.dataset.id);
    if (!item || this.data.invitingId) return;
    this.setData({ invitingId: item.id });
    try {
      const result = await api.call("createInvite", { role: "coach", classId: item.id, displayName: item.headCoachName || item.coachName });
      wx.showModal({ title: "教练绑定邀请码", content: `${result.code}\n\n请教练在“我的”页面输入。`, showCancel: false });
    } finally { this.setData({ invitingId: "" }); }
  }
});
