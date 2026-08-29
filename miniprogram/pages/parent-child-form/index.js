const api = require("../../utils/api");
const { chooseStudentPhoto } = require("../../utils/student-photo");

Page({
  data: { profile: { avatarUrl: "", name: "", gender: "男", birthDate: "2018-01-01", idCardNumber: "", school: "", grade: "", remark: "", relationship: "GUARDIAN" }, saving: false, uploading: false },
  field(event) { this.setData({ [`profile.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  date(event) { this.setData({ "profile.birthDate": event.detail.value }); },
  gender(event) { this.setData({ "profile.gender": event.detail.value }); },
  async avatar() {
    if (this.data.uploading) return;
    this.setData({ uploading: true });
    try { this.setData({ "profile.avatarUrl": await chooseStudentPhoto() }); }
    catch (error) { if (!/cancel/i.test(String(error.errMsg || error.message || ""))) wx.showToast({ title: "照片上传失败", icon: "none" }); }
    finally { this.setData({ uploading: false }); }
  },
  async save() {
    if (this.data.saving) return;
    const profile = this.data.profile;
    if (!profile.avatarUrl || !profile.name.trim() || !/^\d{17}[\dXx]$/.test(profile.idCardNumber.trim()) || !profile.school.trim() || !profile.grade.trim()) return wx.showToast({ title: "请完整填写孩子资料", icon: "none" });
    this.setData({ saving: true });
    try {
      await api.call("submitChildProfile", { profile: { ...profile, idCardNumber: profile.idCardNumber.trim().toUpperCase() } });
      wx.showModal({ title: "提交成功", content: "孩子资料已提交，请等待俱乐部管理员审核。", showCancel: false, success: () => wx.navigateBack() });
    } finally { this.setData({ saving: false }); }
  },
});
