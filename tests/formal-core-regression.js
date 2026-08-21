const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (value) => fs.readFileSync(path.join(root, value), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const v2 = read("cloudfunctions/clubApi/v2.js");
const business = read("cloudfunctions/clubApi/business-service.js");
const payment = read("cloudfunctions/clubApi/payment-service.js");
const api = read("miniprogram/utils/api.js");

const removedPageFragments = ["crm", "lead", "trial", "league", "growth", "elite", "renewals", "feedback", "training-evaluation"];
removedPageFragments.forEach((fragment) => assert(!app.pages.some((page) => page.includes(fragment)), `旧页面仍在注册: ${fragment}`));
assert(!api.includes("local-domain"), "正式测试版不能回退到本地演示数据");

["registerMember", "listUsers", "saveNews", "savePricingRule", "saveCoupon", "createOrder", "listNotifications"].forEach((action) => assert(business.includes(`\"${action}\"`), `缺少正式业务动作: ${action}`));
assert(business.includes("coachId") && business.includes("courseTypeId"), "价格规则必须双绑定教练和课程类型");
assert(business.includes("standardCapacity") || v2.includes("standardCapacity"), "缺少班级容量控制");
assert(v2.includes("classCode") && v2.includes("input.keyword"), "缺少班级号或搜索筛选");

["openCheckin", "selfCheckin", "checkinCode", "latitude", "longitude", "checkinRadius"].forEach((token) => assert(v2.includes(token), `签到缺少: ${token}`));
assert(v2.includes("reviewLeave") && v2.includes("notifications"), "缺少请假审批或通知");
assert(v2.includes("TEST_ROLE_SWITCH_OPENIDS") && v2.includes("canSwitchTestRole"), "缺少受限测试身份切换");

["WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PUBLIC_KEY", "WECHAT_PAY_API_V3_KEY", "SUCCESS"].forEach((token) => assert(payment.includes(token) || business.includes(token), `支付适配缺少: ${token}`));
assert(payment.includes("queryWechatPayment"), "支付成功后必须由服务端查询确认");
assert(business.includes("db.runTransaction") && business.includes('order.status === "PAID"'), "订单结算必须事务化且幂等");

app.pages.forEach((page) => ["js", "json", "wxml", "wxss"].forEach((ext) => assert(fs.existsSync(path.join(root, "miniprogram", `${page}.${ext}`)), `页面文件缺失: ${page}.${ext}`)));
console.log(`formal core regression passed: ${app.pages.length} pages`);
