const api = require("../../utils/api");

Page({
  data: { code: "", scene: "", loading: false, error: "", preview: null, success: false },
  onLoad(options) {
    const scene = decodeURIComponent(String(options.scene || ""));
    if (scene) { this.setData({ scene }); this.preview(); }
  },
  code(event) { this.setData({ code: String(event.detail.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6), error: "", preview: null }); },
  credential() { return this.data.scene ? { scene: this.data.scene } : { code: this.data.code }; },
  async preview() {
    if (this.data.loading) return;
    if (!this.data.scene && !/^NL[A-Z0-9]{4}$/.test(this.data.code)) return this.setData({ error: "请输入管理员提供的6位绑定码" });
    this.setData({ loading: true, error: "" });
    try { this.setData({ preview: await api.call("getCoachInvitePreview", this.credential()), loading: false }); }
    catch (error) { this.setData({ loading: false, preview: null, error: error.message || "绑定邀请无法使用" }); }
  },
  async confirm() {
    if (!this.data.preview || this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.call("confirmCoachBinding", { ...this.credential(), confirmed: true });
      api.finishLogin(result.user);
      this.setData({ loading: false, success: true });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 600);
    } catch (error) { this.setData({ loading: false, error: error.message || "教练账号绑定失败" }); }
  },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/auth/index" }) }); }
});
