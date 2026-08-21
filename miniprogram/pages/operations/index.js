const api = require("../../utils/api");

Page({
  data: { loading: true, error: "", data: { metrics: {}, alerts: [], sessions: [], auditLogs: [] } },
  onShow() { this.load(); }, onPullDownRefresh() { this.load(); },
  async load() { this.setData({ loading: true, error: "" }); try { this.setData({ data: await api.call("getOperationsDashboard"), loading: false }); } catch (error) { this.setData({ loading: false, error: "运营数据加载失败" }); } finally { wx.stopPullDownRefresh(); } },
  sessions() { wx.switchTab({ url: "/pages/sessions/index" }); }, classes() { wx.navigateTo({ url: "/pages/classes/index" }); }, accounts() { wx.navigateTo({ url: "/pages/account-management/index" }); }, news() { wx.navigateTo({ url: "/pages/news/index" }); }, commerce() { wx.navigateTo({ url: "/pages/commerce-admin/index" }); }, orders() { wx.navigateTo({ url: "/pages/orders/index" }); }, leaves() { wx.navigateTo({ url: "/pages/leave-requests/index" }); }, addSession() { wx.navigateTo({ url: "/pages/session-form/index" }); }, attendance(event) { wx.navigateTo({ url: `/pages/attendance/index?sessionId=${event.currentTarget.dataset.id}` }); }
});
