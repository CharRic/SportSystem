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
  coachInvite() { wx.navigateTo({ url: "/pages/coach-team/index" }); }
});
