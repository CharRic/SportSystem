const api = require("../../utils/api");

Page({
  data: { rows: [], role: "parent", loading: true },
  onShow() { this.load(); }, onPullDownRefresh() { this.load(); },
  async load() { this.setData({ loading: true }); try { const context = await api.call("getContext"); const rows = await api.call("listNews", { includeAll: context.user.role === "admin" }); this.setData({ role: context.user.role, rows, loading: false }); } finally { wx.stopPullDownRefresh(); } },
  add() { wx.navigateTo({ url: "/pages/news-form/index" }); },
  edit(event) { if (this.data.role === "admin") wx.navigateTo({ url: `/pages/news-form/index?id=${event.currentTarget.dataset.id}` }); }
});
