const ROLES = Object.freeze({
  PARENT: "parent",
  COACH: "coach",
  ADMIN: "admin",
});

const ACCOUNT_STATES = Object.freeze({
  UNREGISTERED: "UNREGISTERED",
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

function isKnownRole(role) {
  return Object.values(ROLES).includes(String(role || "").toLowerCase());
}

function isActiveUser(user) {
  if (!user) return false;
  if (user.active === false) return false;
  if (!user.status) return true;
  return String(user.status).toUpperCase() === "ACTIVE";
}

function accountState(user) {
  if (!user || !isKnownRole(user.role)) return ACCOUNT_STATES.UNREGISTERED;
  return isActiveUser(user) ? ACCOUNT_STATES.ACTIVE : ACCOUNT_STATES.DISABLED;
}

function publicAuthUser(user) {
  if (!user) return null;
  return {
    id: user._id,
    role: String(user.role || "").toLowerCase(),
    name: user.name || "",
    mobile: user.mobile || "",
    coachId: user.coachId || "",
  };
}

function assertActiveUser(user) {
  const state = accountState(user);
  if (state === ACCOUNT_STATES.UNREGISTERED) {
    const error = new Error("账号尚未注册，请先登录或注册家长账号");
    error.code = "UNREGISTERED";
    throw error;
  }
  if (state === ACCOUNT_STATES.DISABLED) {
    const error = new Error("当前账号暂不可使用，如有疑问请联系南联俱乐部管理员");
    error.code = "ACCOUNT_DISABLED";
    throw error;
  }
  return user;
}

module.exports = {
  ROLES,
  ACCOUNT_STATES,
  isKnownRole,
  isActiveUser,
  accountState,
  publicAuthUser,
  assertActiveUser,
};
