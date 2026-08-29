const api = require("../../utils/api");

const FIELD_LABELS = {
  WECHAT_PAY_APPID: "AppID",
  WECHAT_PAY_MCHID: "商户号",
  WECHAT_PAY_PRIVATE_KEY: "商户私钥",
  WECHAT_PAY_SERIAL_NO: "商户证书序列号",
  WECHAT_PAY_PUBLIC_KEY_ID: "微信支付公钥ID",
  WECHAT_PAY_PUBLIC_KEY: "微信支付公钥",
  WECHAT_PAY_API_V3_KEY: "API v3 Key",
  WECHAT_PAY_NOTIFY_URL: "回调地址",
  PAYMENT_PRODUCTION_ENABLED: "生产开关变量",
};

Page({
  data: { loading: true, error: "", diagnostics: null, fieldRows: [], orderIndex: 0, orderDetail: null, acceptance: null, checking: false },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const diagnostics = await api.call("getPaymentDiagnostics");
      const fields = (diagnostics.environment || {}).fields || {};
      const fieldRows = Object.keys(FIELD_LABELS).map((key) => ({ key, label: FIELD_LABELS[key], configured: Boolean(fields[key]) }));
      this.setData({ diagnostics, fieldRows, missingText: ((diagnostics.environment || {}).missing || []).join("、"), loading: false });
      if ((diagnostics.testOrders || []).length) await this.inspectOrder(diagnostics.testOrders[0].id);
    } catch (error) { this.setData({ loading: false, error: error.message || "支付状态加载失败" }); }
  },
  async selectOrder(event) {
    const orderIndex = Number(event.detail.value || 0); this.setData({ orderIndex, orderDetail: null, acceptance: null });
    const order = (this.data.diagnostics.testOrders || [])[orderIndex]; if (order) await this.inspectOrder(order.id);
  },
  async inspectOrder(id) {
    this.setData({ checking: true });
    try { this.setData({ orderDetail: await api.call("getPaymentOrderDiagnostics", { id }), acceptance: null }); }
    finally { this.setData({ checking: false }); }
  },
  async runAcceptance() {
    const order = (this.data.diagnostics.testOrders || [])[this.data.orderIndex]; if (!order) return;
    this.setData({ checking: true, acceptance: null });
    try { this.setData({ acceptance: await api.call("checkPaymentAcceptance", { id: order.id }) }); }
    finally { this.setData({ checking: false }); }
  },
  packages() { wx.navigateTo({ url: "/pages/commerce-admin/index" }); },
  orders() { wx.navigateTo({ url: "/pages/orders/index" }); },
});
