async function call(action, data = {}) {
  try {
    const response = await wx.cloud.callFunction({ name: "clubApi", data: { action, data } });
    const result = response.result || {};
    if (!result.success) throw new Error(result.message || "请求失败");
    return result.data;
  } catch (error) {
    const message = error && error.message ? error.message : "云端请求失败，请检查云函数部署和网络";
    wx.showToast({ title: message.slice(0, 18), icon: "none" });
    throw error;
  }
}

module.exports = { call };
