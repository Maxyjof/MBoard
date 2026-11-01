// 更新相关的共享常量，服务端接口与前端页面都从这里取

// 强制更新倒计时秒数
export const UPDATE_COUNTDOWN_SECONDS = 15;
export const UPDATE_COUNTDOWN_MS = UPDATE_COUNTDOWN_SECONDS * 1000;

// 页面轮询间隔：空闲时慢一点，倒计时或重建中快一点
export const STATUS_POLL_IDLE_MS = 20_000;
export const STATUS_POLL_ACTIVE_MS = 1_500;

// 触发更新后多久内不接受第二次触发，防止连续点击
export const UPDATE_TRIGGER_COOLDOWN_MS = 10_000;
