const STORAGE_KEY = "floatingAddBtnPos";
const EDGE_MARGIN = 24;
const BOTTOM_SAFE_MARGIN = 72;
const BUTTON_WIDTH = 76;
const BUTTON_HEIGHT = 86;
const LONG_PRESS_DELAY = 300;

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function nearestEdge(x, y, maxX, maxY) {
  const distances = [
    { mode: "left", value: Math.max(0, x - EDGE_MARGIN) },
    { mode: "right", value: Math.max(0, maxX - x) },
    { mode: "bottom", value: Math.max(0, maxY - y) }
  ];
  return distances.sort((a, b) => a.value - b.value)[0].mode;
}

Component({
  data: { areaWidth: 0, areaHeight: 0, x: 0, y: 0, moving: false },
  lifetimes: {
    attached() { this.initPosition(); },
    detached() { this.clearLongPressTimer(); }
  },
  pageLifetimes: {
    resize() { this.initPosition(); }
  },
  methods: {
    getWindowSize() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      return { width: Number(info.windowWidth || 375), height: Number(info.windowHeight || 667) };
    },
    resolvePosition(saved, width, height) {
      const maxX = Math.max(EDGE_MARGIN, width - BUTTON_WIDTH - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, height - BUTTON_HEIGHT - BOTTOM_SAFE_MARGIN);
      if (!saved || !saved.mode) return { x: maxX, y: maxY, mode: "right" };
      const x = saved.mode === "left" ? EDGE_MARGIN : saved.mode === "right" ? maxX : clamp(saved.x, EDGE_MARGIN, maxX);
      const y = saved.mode === "bottom" ? maxY : clamp(saved.y, EDGE_MARGIN, maxY);
      return { x, y, mode: saved.mode };
    },
    initPosition() {
      const { width, height } = this.getWindowSize();
      const position = this.resolvePosition(wx.getStorageSync(STORAGE_KEY), width, height);
      this.position = position;
      this.setData({ areaWidth: width, areaHeight: height, x: position.x, y: position.y });
    },
    clearLongPressTimer() {
      if (!this.longPressTimer) return;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    },
    onTouchStart(event) {
      const touch = event.touches && event.touches[0];
      this.clearLongPressTimer();
      this.suppressTap = false;
      this.touchOffset = touch ? { x: touch.clientX - this.data.x, y: touch.clientY - this.data.y } : { x: BUTTON_WIDTH / 2, y: BUTTON_HEIGHT / 2 };
      this.longPressTimer = setTimeout(() => {
        this.suppressTap = true;
        this.setData({ moving: true });
        if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
      }, LONG_PRESS_DELAY);
    },
    onTouchMove(event) {
      if (!this.data.moving) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const maxX = Math.max(0, this.data.areaWidth - BUTTON_WIDTH);
      const maxY = Math.max(0, this.data.areaHeight - BUTTON_HEIGHT - BOTTOM_SAFE_MARGIN);
      const x = clamp(touch.clientX - this.touchOffset.x, 0, maxX);
      const y = clamp(touch.clientY - this.touchOffset.y, 0, maxY);
      this.position = { x, y, mode: "free" };
      this.setData({ x, y });
    },
    onTouchEnd() {
      this.clearLongPressTimer();
      if (!this.data.moving) return;
      const maxX = Math.max(EDGE_MARGIN, this.data.areaWidth - BUTTON_WIDTH - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, this.data.areaHeight - BUTTON_HEIGHT - BOTTOM_SAFE_MARGIN);
      const current = this.position || { x: this.data.x, y: this.data.y };
      const currentX = clamp(current.x, EDGE_MARGIN, maxX);
      const currentY = clamp(current.y, EDGE_MARGIN, maxY);
      const mode = nearestEdge(currentX, currentY, maxX, maxY);
      const x = mode === "left" ? EDGE_MARGIN : mode === "right" ? maxX : currentX;
      const y = mode === "bottom" ? maxY : currentY;
      const saved = { x, y, mode };
      this.position = saved;
      wx.setStorageSync(STORAGE_KEY, saved);
      this.setData({ x, y, moving: false });
      setTimeout(() => { this.suppressTap = false; }, 450);
    },
    onTouchCancel() { this.onTouchEnd(); },
    onTap() {
      if (!this.suppressTap && !this.data.moving) this.triggerEvent("add");
    }
  }
});

module.exports = { clamp, nearestEdge };
