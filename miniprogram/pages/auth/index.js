const api = require("../../utils/api");

Page({
  data: {
    mode: "WELCOME",
    loading: false,
    error: "",
    staffMessage: "",
    staffCode: "",
    form: { name: "", mobile: "", phoneCode: "" },
  },
  onLoad(options) {
    this.options = options || {};
  },
  onShow() {
    if (wx.getStorageSync("sessionLoggedOut") || this.options.loggedOut === "1") return;
    this.quickLogin(true);
  },
  async quickLogin(silent = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try {
      const context = await api.call("getAuthContext");
      if (context.accountState === "DISABLED") {
        this.setData({ mode: "DISABLED", loading: false });
        return;
      }
      if (!context.registered || context.accountState === "UNREGISTERED") {
        this.setData({ mode: "WELCOME", loading: false, error: silent ? "" : "尚未注册，请注册家长账号或使用工作人员登录。" });
        return;
      }
      api.finishLogin(context.user);
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "微信登录失败，请检查网络后重试" });
    }
  },
  showParentRegister() {
    this.setData({ mode: "PARENT_REGISTER", error: "", staffMessage: "" });
  },
  showStaffLogin() {
    this.setData({ mode: "STAFF", error: "", staffMessage: "" }, () => this.staffLogin());
  },
  goCoachBind() { wx.navigateTo({ url: "/pages/coach-bind/index" }); },
  back() {
    this.setData({ mode: "WELCOME", error: "", staffMessage: "" });
  },
  field(event) {
    this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value });
  },
  staffCode(event) {
    this.setData({ staffCode: event.detail.value });
  },
  phoneNumber(event) {
    const code = event.detail && event.detail.code;
    if (!code) {
      this.setData({ "form.phoneCode": "", error: "手机号授权已取消，可在下方手动填写手机号。" });
      return;
    }
    this.setData({ "form.phoneCode": code, error: "", "form.mobile": "" });
    wx.showToast({ title: "手机号授权成功", icon: "success" });
  },
  async registerParent() {
    if (this.data.loading) return;
    const { name, mobile, phoneCode } = this.data.form;
    if (!name.trim()) return this.setData({ error: "请填写家长姓名" });
    if (!phoneCode && !/^1\d{10}$/.test(mobile.trim())) return this.setData({ error: "请授权微信手机号或手动填写正确的手机号" });
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.call("registerParent", { name: name.trim(), mobile: mobile.trim(), phoneCode });
      api.finishLogin(result.user);
      wx.showToast({ title: "家长账号注册成功", icon: "success" });
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "注册失败，请稍后重试" });
    }
  },
  async staffLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, staffMessage: "", error: "" });
    try {
      const result = await api.call("staffLogin");
      if (!result.authorized) {
        this.setData({ loading: false, staffMessage: result.message || "暂未找到您的工作人员账号，请联系南联俱乐部管理员完成账号授权。" });
        return;
      }
      api.finishLogin(result.user);
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      this.setData({ loading: false, staffMessage: error.message || "工作人员身份识别失败，请稍后重试" });
    }
  },
  async claimStaffInvite() {
    if (this.data.loading) return;
    if (!/^\d{6}$/.test(this.data.staffCode)) return this.setData({ staffMessage: "请输入管理员提供的6位工作人员授权码。" });
    this.setData({ loading: true, staffMessage: "", error: "" });
    try {
      const result = await api.call("claimStaffInvite", { code: this.data.staffCode });
      api.finishLogin(result.user);
      wx.showToast({ title: "工作人员身份已授权", icon: "success" });
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      this.setData({ loading: false, staffMessage: error.message || "工作人员授权失败，请联系管理员" });
    }
  },
});
