// 系统广播的发送端
// 广播中枢在 server.mjs 里创建并挂到 globalThis：
// Next 的接口路由和自定义服务器同进程，但打包后的模块实例不是同一份，只能靠 globalThis 共享

type SystemHub = {
  publish: (payload: unknown) => number;
  size: () => number;
};

function getHub(): SystemHub | null {
  const store = globalThis as { __mbSystemHub?: SystemHub };
  return store.__mbSystemHub ?? null;
}

// 向所有在线页面推送一条通知，没有连接时静默返回 0
export function publishSystem(payload: unknown) {
  const hub = getHub();
  if (!hub) return 0;
  try {
    return hub.publish(payload);
  } catch (error) {
    console.error("[system] 广播失败", error);
    return 0;
  }
}

export function onlineCount() {
  return getHub()?.size() ?? 0;
}
