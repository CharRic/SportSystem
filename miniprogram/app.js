App({
  onLaunch() {
    this.globalData = {
      // 正式测试版只连接云端，不再回退到本地演示数据。
      env: "cloud1-d2g4gi77g48dcee01",
      dataMode: "cloud",
      activeStudentId: wx.getStorageSync("activeStudentId") || "",
      authUser: wx.getStorageSync("authUser") || null,
    };

    if (!wx.cloud) throw new Error("当前基础库不支持云开发，请升级微信开发者工具");
    wx.cloud.init({ env: this.globalData.env, traceUser: true });
  },
});
