const api = require("../../utils/api");
const { roleLabels } = require("../../utils/format");

Page({
  data: { context: null, roleLabel: "", modeLabel: "", inviteCode: "", loading: true, error: "", binding: false, switchingRole: false, roles: [{ value: "admin", label: "管理员" }, { value: "coach", label: "教练员" }, { value: "parent", label: "学员端" }] },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const context = await api.call("getContext");
      this.setData({ context, roleLabel: roleLabels[context.user.role], modeLabel: context.mode === "local" ? "本地演示" : "云端共享", loading: false });
    } catch (error) { this.setData({ loading: false, error: "账号信息加载失败" }); }
  },
  async switchRole(event) {
    const role = event.currentTarget.dataset.role;
    if (!this.data.context.canSwitchTestRole || this.data.switchingRole) return;
    this.setData({ switchingRole: true });
    try {
      await api.call("switchTestRole", { role });
      wx.showToast({ title: `已切换为${roleLabels[role]}`, icon: "none" });
      await this.load();
    } finally {
      this.setData({ switchingRole: false });
    }
  },
  sessions() { wx.switchTab({ url: "/pages/sessions/index" }); },
  leaves() { wx.navigateTo({ url: "/pages/leave-requests/index" }); },
  operations() { wx.navigateTo({ url: "/pages/operations/index" }); },
  classes() { wx.navigateTo({ url: "/pages/classes/index" }); },
  register() { wx.navigateTo({ url: "/pages/parent-child-form/index" }); },
  accounts() { wx.navigateTo({ url: "/pages/account-management/index" }); },
  news() { wx.navigateTo({ url: "/pages/news/index" }); },
  commerce() { wx.navigateTo({ url: "/pages/commerce-admin/index" }); },
  orders() { wx.navigateTo({ url: "/pages/orders/index" }); },
  notifications() { wx.navigateTo({ url: "/pages/notifications/index" }); },
  logout() {
    wx.showModal({ title: "退出登录", content: "退出只会清理本机登录状态，不会删除账号、孩子或历史业务数据。", success: (result) => { if (result.confirm) api.logout(); } });
  },
  inviteInput(event) { this.setData({ inviteCode: event.detail.value }); },
  async claimInvite() {
    if (this.data.binding) return;
    if (this.data.inviteCode.length !== 6) { wx.showToast({ title: "请输入6位邀请码", icon: "none" }); return; }
    this.setData({ binding: true });
    try {
      await api.call("claimInvite", { code: this.data.inviteCode });
      wx.showToast({ title: "身份绑定成功" }); this.setData({ inviteCode: "" }); this.load();
    } finally { this.setData({ binding: false }); }
  }
});
