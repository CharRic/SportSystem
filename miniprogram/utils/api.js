async function call(action, data = {}) {
  try {
    const response = await wx.cloud.callFunction({ name: "clubApi", data: { action, data } });
    const result = response.result || {};
    if (!result.success) {
      const error = new Error(result.message || "请求失败");
      error.code = result.code || "SERVICE_ERROR";
      if (["UNREGISTERED", "ACCOUNT_DISABLED"].includes(error.code)) {
        const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
        const route = pages.length ? pages[pages.length - 1].route : "";
        if (route !== "pages/auth/index") wx.reLaunch({ url: `/pages/auth/index?reason=${error.code}` });
      }
      throw error;
    }
    return result.data;
  } catch (error) {
    const message = error && error.message ? error.message : "云端请求失败，请检查云函数部署和网络";
    wx.showToast({ title: message.slice(0, 18), icon: "none" });
    throw error;
  }
}

function finishLogin(user) {
  wx.setStorageSync("authUser", user || null);
  wx.removeStorageSync("sessionLoggedOut");
  getApp().globalData.authUser = user || null;
}

function logout() {
  wx.removeStorageSync("authUser");
  wx.removeStorageSync("activeStudentId");
  wx.setStorageSync("sessionLoggedOut", true);
  const app = getApp();
  app.globalData.authUser = null;
  app.globalData.activeStudentId = "";
  wx.reLaunch({ url: "/pages/auth/index?loggedOut=1" });
}

module.exports = { call, finishLogin, logout };
