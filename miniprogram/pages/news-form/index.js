const api = require("../../utils/api");

Page({
  data: { id: "", item: { title: "", category: "公告", summary: "", content: "", coverUrl: "", status: "PUBLISHED" }, statuses: ["PUBLISHED", "DRAFT"], statusLabels: ["立即发布", "保存草稿"], statusIndex: 0, saving: false },
  async onLoad(options) { this.setData({ id: options.id || "" }); if (options.id) { const rows = await api.call("listNews", { includeAll: true }); const item = rows.find((row) => row.id === options.id); if (item) this.setData({ item, statusIndex: item.status === "DRAFT" ? 1 : 0 }); } },
  field(event) { this.setData({ [`item.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  status(event) { const statusIndex = Number(event.detail.value); this.setData({ statusIndex, "item.status": this.data.statuses[statusIndex] }); },
  async save() { if (this.data.saving) return; this.setData({ saving: true }); try { await api.call("saveNews", { item: { ...this.data.item, id: this.data.id || undefined } }); wx.showToast({ title: "已保存" }); setTimeout(() => wx.navigateBack(), 400); } finally { this.setData({ saving: false }); } }
});
