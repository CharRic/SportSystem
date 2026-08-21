const api = require("../../utils/api");

Page({
  data: { config: { courseTypes: [], pricingRules: [], coupons: [], coaches: [] }, course: { name: "", lessons: 14, description: "" }, price: { amount: "" }, coupon: { code: "", name: "", discountType: "PERCENT", discountValue: 10, minAmount: 0, totalLimit: 0, startAt: "2026-01-01", endAt: "2027-12-31" }, coachIndex: 0, typeIndex: 0, discountIndex: 0, discountLabels: ["按比例减免", "固定金额减免"], saving: "", loading: true, payment: null },
  onShow() { this.load(); },
  async load() { this.setData({ loading: true }); const [config, payment] = await Promise.all([api.call("listCommerceConfig"), api.call("getPaymentReadiness")]); this.setData({ config: { ...config, pricingRules: config.pricingRules.map((item) => ({ ...item, amountYuan: (Number(item.amount || 0) / 100).toFixed(2) })) }, payment, loading: false }); },
  field(event) { this.setData({ [`${event.currentTarget.dataset.form}.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  coach(event) { this.setData({ coachIndex: Number(event.detail.value) }); }, type(event) { this.setData({ typeIndex: Number(event.detail.value) }); },
  discount(event) { const discountIndex = Number(event.detail.value); this.setData({ discountIndex, "coupon.discountType": discountIndex ? "FIXED" : "PERCENT" }); },
  date(event) { this.setData({ [`coupon.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  async saveCourse() { this.setData({ saving: "course" }); try { await api.call("saveCourseType", { item: this.data.course }); this.setData({ course: { name: "", lessons: 14, description: "" } }); await this.load(); } finally { this.setData({ saving: "" }); } },
  async savePrice() { const coach = this.data.config.coaches[this.data.coachIndex], type = this.data.config.courseTypes[this.data.typeIndex]; if (!coach || !type) return wx.showToast({ title: "请先配置教练和课程类型", icon: "none" }); this.setData({ saving: "price" }); try { await api.call("savePricingRule", { item: { coachId: coach.id, courseTypeId: type.id, amount: this.data.price.amount } }); this.setData({ price: { amount: "" } }); await this.load(); } finally { this.setData({ saving: "" }); } },
  async saveCoupon() { this.setData({ saving: "coupon" }); try { await api.call("saveCoupon", { item: this.data.coupon }); this.setData({ "coupon.code": "", "coupon.name": "" }); await this.load(); } finally { this.setData({ saving: "" }); } }
});
