const { today } = require("./format");
const STORAGE_KEY = "sportSystemDemoV1";
const PACKAGES = {
  p10: { lessons: 10, amount: 1500 },
  p20: { lessons: 20, amount: 2800 },
  p40: { lessons: 40, amount: 5200 }
};

function seed() {
  return {
    students: [
      { id: "s1", name: "林一诺", gender: "男", birthDate: "2016-03-18", guardianName: "林女士", guardianPhone: "138****1203", healthNotes: "无", remainingLessons: 18, totalLessons: 30, classIds: ["c1"], status: "active" },
      { id: "s2", name: "周子航", gender: "男", birthDate: "2015-11-02", guardianName: "周先生", guardianPhone: "136****9081", healthNotes: "左膝旧伤，训练前注意热身", remainingLessons: 4, totalLessons: 20, classIds: ["c1"], status: "active" },
      { id: "s3", name: "陈思琪", gender: "女", birthDate: "2017-07-09", guardianName: "陈女士", guardianPhone: "139****6618", healthNotes: "无", remainingLessons: 11, totalLessons: 20, classIds: ["c2"], status: "active" },
      { id: "s4", name: "王奕辰", gender: "男", birthDate: "2016-09-23", guardianName: "王先生", guardianPhone: "137****4329", healthNotes: "近期脚踝轻微不适", remainingLessons: 2, totalLessons: 20, classIds: ["c2"], status: "active" }
    ],
    classes: [
      { id: "c1", name: "U10 提高班", coachName: "张教练", schedule: "周三 18:30 / 周六 09:00", venue: "一号足球场", studentIds: ["s1", "s2"], active: true },
      { id: "c2", name: "U8 基础班", coachName: "李教练", schedule: "周二 18:30 / 周日 10:00", venue: "二号足球场", studentIds: ["s3", "s4"], active: true }
    ],
    attendance: [
      { id: "a1", classId: "c1", studentId: "s1", date: "2026-08-16", status: "present", deductedLessons: 1 },
      { id: "a2", classId: "c1", studentId: "s2", date: "2026-08-16", status: "leave", deductedLessons: 0 },
      { id: "a3", classId: "c2", studentId: "s3", date: "2026-08-17", status: "present", deductedLessons: 1 },
      { id: "a4", classId: "c2", studentId: "s4", date: "2026-08-17", status: "sick", deductedLessons: 0 }
    ],
    renewals: [{ id: "r1", studentId: "s4", lessons: 20, amount: 2800, status: "pending", createdAt: "2026-08-18 14:20" }]
  };
}

function load() {
  let data = wx.getStorageSync(STORAGE_KEY);
  if (!data || !data.students) { data = seed(); wx.setStorageSync(STORAGE_KEY, data); }
  return data;
}
function save(data) { wx.setStorageSync(STORAGE_KEY, data); }
function id(prefix) { return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`; }
function classIdsForRole(data, role) {
  if (role === "admin") return data.classes.map((item) => item.id);
  if (role === "coach") return ["c1"];
  return [...new Set(data.students.slice(0, 1).flatMap((item) => item.classIds || []))];
}
function visibleStudents(data, role) {
  if (role === "admin") return data.students;
  if (role === "parent") return data.students.slice(0, 1);
  const classIds = classIdsForRole(data, role);
  const studentIds = data.classes.filter((item) => classIds.includes(item.id)).flatMap((item) => item.studentIds || []);
  return data.students.filter((item) => studentIds.includes(item.id));
}
function assertRole(role, roles) { if (!roles.includes(role)) throw new Error("没有执行该操作的权限"); }

async function call(action, input = {}) {
  const data = load();
  const role = input.previewRole || "admin";
  switch (action) {
    case "getContext":
      return { mode: "local", user: { name: role === "admin" ? "俱乐部管理员" : role === "coach" ? "张教练" : "林女士", role }, needsBinding: false };
    case "getDashboard": {
      const students = visibleStudents(data, role);
      const classIds = classIdsForRole(data, role);
      const classes = data.classes.filter((item) => classIds.includes(item.id));
      const studentIds = students.map((item) => item.id);
      const renewals = role === "admin" ? data.renewals : role === "parent" ? data.renewals.filter((item) => studentIds.includes(item.studentId)) : [];
      const attention = [...students].sort((a, b) => a.remainingLessons - b.remainingLessons).slice(0, 3);
      return { role, studentCount: students.length, classCount: classes.length, lowBalance: students.filter((item) => item.remainingLessons <= 5).length, pendingRenewals: renewals.filter((item) => item.status === "pending").length, todayAttendance: data.attendance.filter((item) => item.date === today() && studentIds.includes(item.studentId)).length, recentStudents: attention.map((item) => ({ ...item, initial: item.name ? item.name[0] : "学" })), classes };
    }
    case "listStudents":
      return visibleStudents(data, role).map((student) => ({ ...student, initial: student.name ? student.name[0] : "学", classNames: data.classes.filter((item) => student.classIds.includes(item.id)).map((item) => item.name).join("、") }));
    case "getStudent": {
      const student = data.students.find((item) => item.id === input.id);
      if (!student) throw new Error("未找到学员");
      if (!visibleStudents(data, role).some((item) => item.id === student.id)) throw new Error("无权查看该学员");
      return { ...student, classes: data.classes.filter((item) => student.classIds.includes(item.id)), attendance: data.attendance.filter((item) => item.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date)), renewals: role === "coach" ? [] : data.renewals.filter((item) => item.studentId === student.id) };
    }
    case "saveStudent": {
      assertRole(role, ["admin"]);
      const payload = input.student;
      if (payload.id) {
        const index = data.students.findIndex((item) => item.id === payload.id);
        if (index < 0) throw new Error("未找到学员");
        const current = data.students[index];
        data.students[index] = { ...current, ...payload, remainingLessons: current.remainingLessons, totalLessons: current.totalLessons };
      } else {
        const initialLessons = Math.max(0, Number(payload.remainingLessons || 0));
        data.students.push({ ...payload, id: id("s"), remainingLessons: initialLessons, totalLessons: initialLessons, classIds: payload.classIds || [], status: "active" });
      }
      const studentId = payload.id || data.students[data.students.length - 1].id;
      data.classes.forEach((clubClass) => {
        const selected = (payload.classIds || []).includes(clubClass.id);
        clubClass.studentIds = selected ? [...new Set([...(clubClass.studentIds || []), studentId])] : (clubClass.studentIds || []).filter((item) => item !== studentId);
      });
      save(data); return { ok: true };
    }
    case "listClasses": {
      const ids = classIdsForRole(data, role);
      return data.classes.filter((item) => ids.includes(item.id)).map((item) => ({ ...item, studentCount: item.studentIds.length }));
    }
    case "getClass": {
      assertRole(role, ["admin"]);
      const clubClass = data.classes.find((item) => item.id === input.id);
      if (!clubClass) throw new Error("未找到班级");
      return { ...clubClass };
    }
    case "saveClass": {
      assertRole(role, ["admin"]);
      const payload = input.clubClass;
      let classId = payload.id;
      if (classId) {
        const index = data.classes.findIndex((item) => item.id === classId);
        data.classes[index] = { ...data.classes[index], ...payload, active: true };
      } else {
        classId = id("c");
        data.classes.push({ ...payload, id: classId, studentIds: payload.studentIds || [], active: true });
      }
      data.students.forEach((student) => {
        const classIds = student.classIds || [];
        const selected = (payload.studentIds || []).includes(student.id);
        student.classIds = selected ? [...new Set([...classIds, classId])] : classIds.filter((item) => item !== classId);
      });
      save(data); return { id: classId };
    }
    case "getAttendanceSheet": {
      if (role === "parent") throw new Error("家长不能执行点名");
      if (role === "coach" && !classIdsForRole(data, role).includes(input.classId)) throw new Error("无权点名该班级");
      const clubClass = data.classes.find((item) => item.id === input.classId);
      const records = data.attendance.filter((item) => item.classId === input.classId && item.date === input.date);
      return { clubClass, date: input.date, students: clubClass.studentIds.map((studentId) => {
        const student = data.students.find((item) => item.id === studentId);
        const record = records.find((item) => item.studentId === studentId);
        return { ...student, attendanceStatus: record ? record.status : "unmarked" };
      }) };
    }
    case "submitAttendance": {
      if (role === "parent") throw new Error("家长不能执行点名");
      if (role === "coach" && !classIdsForRole(data, role).includes(input.classId)) throw new Error("无权点名该班级");
      input.records.forEach((record) => {
        const existing = data.attendance.find((item) => item.classId === input.classId && item.studentId === record.studentId && item.date === input.date);
        const nextDeduction = ["present", "absent"].includes(record.status) ? 1 : 0;
        const previousDeduction = existing ? existing.deductedLessons : 0;
        const student = data.students.find((item) => item.id === record.studentId);
        student.remainingLessons = Math.max(0, student.remainingLessons - nextDeduction + previousDeduction);
        if (existing) Object.assign(existing, record, { deductedLessons: nextDeduction });
        else data.attendance.push({ id: id("a"), classId: input.classId, date: input.date, ...record, deductedLessons: nextDeduction });
      });
      save(data); return { ok: true };
    }
    case "listRenewals": {
      if (role === "coach") return [];
      const allowedIds = visibleStudents(data, role).map((item) => item.id);
      return data.renewals.filter((item) => role === "admin" || allowedIds.includes(item.studentId)).map((renewal) => ({ ...renewal, studentName: (data.students.find((item) => item.id === renewal.studentId) || {}).name || "" })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    case "createRenewal": {
      assertRole(role, ["admin", "parent"]);
      const pack = PACKAGES[input.packageId];
      if (!pack) throw new Error("续费套餐无效");
      if (!visibleStudents(data, role).some((item) => item.id === input.studentId)) throw new Error("无权为该学员续费");
      data.renewals.push({ id: id("r"), studentId: input.studentId, packageId: input.packageId, lessons: pack.lessons, amount: pack.amount, status: "pending", createdAt: `${today()} 现在` });
      save(data); return { ok: true };
    }
    case "confirmRenewal": {
      assertRole(role, ["admin"]);
      const renewal = data.renewals.find((item) => item.id === input.id);
      if (!renewal || renewal.status !== "pending") throw new Error("订单状态已变化");
      renewal.status = "paid"; renewal.paidAt = `${today()} 现在`;
      const student = data.students.find((item) => item.id === renewal.studentId);
      student.remainingLessons += renewal.lessons; student.totalLessons += renewal.lessons;
      save(data); return { ok: true };
    }
    case "createInvite": assertRole(role, ["admin"]); return { code: "演示模式" };
    case "claimInvite": return { ok: true };
    case "resetDemo": wx.setStorageSync(STORAGE_KEY, seed()); return { ok: true };
    default: throw new Error(`暂不支持操作：${action}`);
  }
}

module.exports = { call };
