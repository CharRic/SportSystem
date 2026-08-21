const roleLabels = { admin: "管理员", coach: "教练员", parent: "学员端" };
const attendanceLabels = { present: "到课", leave: "请假", sick: "伤病", absent: "缺勤" };

function dateText(value) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value.replace(/-/g, "/")) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function today() { return dateText(new Date()); }

module.exports = { roleLabels, attendanceLabels, dateText, today };
