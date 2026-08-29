const api = require("../../utils/api");
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function addMinutes(value, minutes) {
  const [hour, minute] = String(value || "09:00").split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function parseSchedule(schedule) {
  const slots = [];
  const pattern = /((?:周)?[一二三四五六日天](?:\/[一二三四五六日天])*)\s*(\d{2}:\d{2})(?:\s*[-至~]\s*(\d{2}:\d{2}))?/g;
  let match;
  while ((match = pattern.exec(String(schedule || "")))) {
    const days = match[1].replace(/^周/, "").split("/").map((day) => day === "天" ? "日" : day);
    days.forEach((day) => {
      const weekday = `周${day}`;
      slots.push({ weekday, weekdayIndex: Math.max(0, WEEKDAYS.indexOf(weekday)), startTime: match[2], endTime: match[3] || addMinutes(match[2], 90) });
    });
  }
  return slots.length ? slots : [{ weekday: "周六", weekdayIndex: 5, startTime: "09:00", endTime: "10:30" }];
}

Page({
  data: { id: "", role: "admin", coaches: [], coachIndex: 0, assistantCoachIds: [], weekdays: WEEKDAYS, scheduleSlots: [{ weekday: "周六", weekdayIndex: 5, startTime: "09:00", endTime: "10:30" }], classTypes: [{ value: "REGULAR", label: "普通班" }, { value: "ELITE", label: "精英队" }], typeIndex: 0, statuses: [{ value: "ACTIVE", label: "启用" }, { value: "INACTIVE", label: "停用" }], statusIndex: 0, clubClass: { name: "", classType: "REGULAR", ageGroup: "", standardCapacity: 20, headCoachUserId: "", headCoachName: "", assistantCoachIds: [], assistantCoachName: "", schedule: "", venue: "", status: "ACTIVE", remark: "" }, saving: false, loading: true, error: "" },
  async onLoad(options) {
    this.options = options;
    wx.setNavigationBarTitle({ title: options.id ? "编辑班级" : "新增班级" });
    try {
      const [context, rawCoaches, existing] = await Promise.all([api.call("getContext"), api.call("listClassCoaches"), options.id ? api.call("getClass", { id: options.id }) : Promise.resolve(null)]);
      const coaches = context.user.role === "admin" ? [{ id: "", name: "请选择教练档案" }, ...rawCoaches] : rawCoaches;
      const clubClass = existing || { ...this.data.clubClass, headCoachUserId: context.user.role === "coach" ? context.user.id : "", headCoachName: context.user.role === "coach" ? context.user.name : "" };
      const coachIndex = Math.max(0, coaches.findIndex((item) => item.id === clubClass.headCoachUserId));
      const scheduleSlots = Array.isArray(clubClass.scheduleSlots) && clubClass.scheduleSlots.length ? clubClass.scheduleSlots.map((slot) => ({ ...slot, weekdayIndex: Math.max(0, WEEKDAYS.indexOf(slot.weekday)) })) : parseSchedule(clubClass.schedule);
      this.setData({ id: options.id || "", role: context.user.role, coaches: coaches.map((item) => ({ ...item, checked: (clubClass.assistantCoachIds || []).includes(item.id) })), coachIndex, assistantCoachIds: clubClass.assistantCoachIds || [], clubClass, scheduleSlots, typeIndex: clubClass.classType === "ELITE" ? 1 : 0, statusIndex: clubClass.status === "INACTIVE" ? 1 : 0, loading: false });
    } catch (error) { this.setData({ loading: false, error: "表单加载失败" }); }
  },
  retry() { this.setData({ loading: true, error: "" }); this.onLoad(this.options || {}); },
  field(event) { this.setData({ [`clubClass.${event.currentTarget.dataset.key}`]: event.detail.value }); },
  type(event) { const index = Number(event.detail.value); this.setData({ typeIndex: index, "clubClass.classType": this.data.classTypes[index].value }); },
  coach(event) { const coachIndex = Number(event.detail.value); const coach = this.data.coaches[coachIndex]; const assistantCoachIds = this.data.assistantCoachIds.filter((id) => id !== coach.id); this.setData({ coachIndex, assistantCoachIds, coaches: this.data.coaches.map((item) => ({ ...item, checked: assistantCoachIds.includes(item.id) })), "clubClass.assistantCoachIds": assistantCoachIds, "clubClass.headCoachUserId": coach.id, "clubClass.headCoachName": coach.id ? coach.name : "" }); },
  assistants(event) { const assistantCoachIds = (event.detail.value || []).filter((id) => id !== this.data.clubClass.headCoachUserId); this.setData({ assistantCoachIds, coaches: this.data.coaches.map((item) => ({ ...item, checked: assistantCoachIds.includes(item.id) })), "clubClass.assistantCoachIds": assistantCoachIds }); },
  slotWeekday(event) { const index = Number(event.currentTarget.dataset.index); const weekdayIndex = Number(event.detail.value); this.setData({ [`scheduleSlots[${index}].weekdayIndex`]: weekdayIndex, [`scheduleSlots[${index}].weekday`]: this.data.weekdays[weekdayIndex] }); },
  slotTime(event) { const index = Number(event.currentTarget.dataset.index); const key = event.currentTarget.dataset.key; this.setData({ [`scheduleSlots[${index}].${key}`]: event.detail.value }); },
  addSlot() { this.setData({ scheduleSlots: [...this.data.scheduleSlots, { weekday: "周六", weekdayIndex: 5, startTime: "09:00", endTime: "10:30" }] }); },
  removeSlot(event) { const index = Number(event.currentTarget.dataset.index); if (this.data.scheduleSlots.length > 1) this.setData({ scheduleSlots: this.data.scheduleSlots.filter((_, itemIndex) => itemIndex !== index) }); },
  status(event) { const index = Number(event.detail.value); this.setData({ statusIndex: index, "clubClass.status": this.data.statuses[index].value }); },
  async save() {
    if (this.data.saving) return;
    const scheduleSlots = this.data.scheduleSlots.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }));
    if (scheduleSlots.some((slot) => !slot.weekday || !slot.startTime || !slot.endTime || slot.startTime >= slot.endTime)) { wx.showToast({ title: "请检查训练时段", icon: "none" }); return; }
    const schedule = scheduleSlots.map((slot) => `${slot.weekday} ${slot.startTime}-${slot.endTime}`).join(" / ");
    const clubClass = { ...this.data.clubClass, assistantCoachIds: this.data.assistantCoachIds.filter((id) => id !== this.data.clubClass.headCoachUserId), name: this.data.clubClass.name.trim(), schedule, scheduleSlots, venue: this.data.clubClass.venue.trim(), standardCapacity: Number(this.data.clubClass.standardCapacity) };
    if (!clubClass.name || !clubClass.ageGroup || !clubClass.headCoachUserId || !clubClass.headCoachName || !clubClass.venue || clubClass.standardCapacity < 1) { wx.showToast({ title: "请完整填写班级信息并选择教练档案", icon: "none" }); return; }
    this.setData({ saving: true });
    try {
      await api.call("saveClass", { clubClass: { ...clubClass, id: this.data.id || undefined } });
      wx.showToast({ title: "班级已保存" }); setTimeout(() => wx.navigateBack(), 400);
    } finally { this.setData({ saving: false }); }
  }
});
