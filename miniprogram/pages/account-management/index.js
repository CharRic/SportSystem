const api = require("../../utils/api");
const labels = { admin: "管理员", coach: "教练员", parent: "学员端" };

Page({
  data: { users: [], name: "", loading: true, creating: false },
  onShow() { this.load(); },
  async load() { this.setData({ loading: true }); try { const users = await api.call("listUsers"); this.setData({ users: users.map((item) => ({ ...item, roleLabel: labels[item.role] || item.role })), loading: false }); } catch (error) { this.setData({ loading: false }); } },
  name(event) { this.setData({ name: event.detail.value }); },
  async inviteAdmin() { if (this.data.creating) return; this.setData({ creating: true }); try { const result = await api.call("createInvite", { role: "admin", displayName: this.data.name.trim() || "俱乐部管理员" }); wx.showModal({ title: "管理员邀请码", content: `${result.code}\n\n24小时内有效，只能使用一次。`, showCancel: false }); } finally { this.setData({ creating: false }); } }
});
