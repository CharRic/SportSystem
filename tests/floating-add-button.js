const assert = require("assert");

let definition;
let stored = null;
global.Component = (config) => { definition = config; };
global.wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  getStorageSync: () => stored,
  setStorageSync: (key, value) => { assert.strictEqual(key, "floatingAddBtnPos"); stored = value; },
  vibrateShort: () => {}
};

const { clamp, nearestEdge } = require("../miniprogram/components/floating-add-button/index");

function createComponent() {
  const component = {
    data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); },
    triggerEvent(name) { this.triggered = name; }
  };
  Object.entries(definition.methods).forEach(([name, method]) => { component[name] = method.bind(component); });
  return component;
}

assert.strictEqual(clamp(-5, 0, 10), 0);
assert.strictEqual(clamp(15, 0, 10), 10);
assert.strictEqual(nearestEdge(24, 220, 275, 557), "left");
assert.strictEqual(nearestEdge(275, 220, 275, 557), "right");
assert.strictEqual(nearestEdge(150, 557, 275, 557), "bottom");

const component = createComponent();
component.initPosition();
assert.deepStrictEqual(
  { width: component.data.areaWidth, height: component.data.areaHeight, x: component.data.x, y: component.data.y },
  { width: 375, height: 667, x: 275, y: 509 }
);
assert.ok(component.data.y + 86 <= 667 - 72, "default position must stay above the bottom navigation safe area");

component.data.moving = true;
component.position = { x: 25, y: 260, mode: "free" };
component.onTouchEnd();
assert.deepStrictEqual(stored, { x: 24, y: 260, mode: "left" });

component.suppressTap = false;
component.onTap();
assert.strictEqual(component.triggered, "add");

console.log("floating add button tests passed");
