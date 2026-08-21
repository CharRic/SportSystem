const api = require("../../utils/api");
const { chooseStudentPhoto } = require("../../utils/student-photo");

Page({
  data: { profile: { avatarUrl: "", name: "", gender: "男", birthDate: "2018-01-01", mobile: "", guardianName: "", school: "", grade: "", remark: "", relationship: "GUARDIAN" }, saving: false, uploading: false },
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
    if (!profile.name.trim() || !/^1\d{10}$/.test(profile.mobile)) return wx.showToast({ title: "请填写姓名和正确手机号", icon: "none" });
    this.setData({ saving: true });
    try {
      await api.call("registerMember", { profile });
      wx.showModal({ title: "注册成功", content: "学员档案已经创建，现在可以查询并报名班级。", showCancel: false, success: () => wx.navigateBack() });
    } finally { this.setData({ saving: false }); }
  },
});
