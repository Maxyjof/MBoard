"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LayoutGrid, Loader2, PenLine, Sparkles, Users, Wand2 } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

type LoginScreenProps = {
  nextPath: string;
  appName: string;
};

const features = [
  {
    icon: <LayoutGrid className="h-4 w-4" />,
    title: "看板与日程",
    desc: "列表卡片自由拖拽，计划和进度一眼看清",
  },
  {
    icon: <PenLine className="h-4 w-4" />,
    title: "无限画布",
    desc: "流程图、结构图、便签与文档，全都放得下",
  },
  {
    icon: <Users className="h-4 w-4" />,
    title: "实时协作",
    desc: "多人同屏编辑，光标与改动即时可见",
  },
  {
    icon: <Wand2 className="h-4 w-4" />,
    title: "开箱即用",
    desc: "配置文件管理账号，一条命令完成部署",
  },
];

export function LoginScreen({ nextPath, appName }: LoginScreenProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error || "登录失败，请稍后再试");
        setPending(false);
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("网络异常，请检查服务是否已启动");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 左侧品牌区 */}
      <div className="relative hidden w-[56%] overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between">
        <div className="mesh pointer-events-none absolute inset-0 opacity-70" />
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" />

        <div className="relative z-10 flex items-center gap-2.5 px-12 pt-10">
          <BrandMark size={34} />
          <div>
            <p className="text-[15px] font-semibold tracking-tight">MBoard</p>
            <p className="text-[11px] text-muted">共享协作工作台</p>
          </div>
        </div>

        <div className="relative z-10 px-12">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[11.5px] text-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            Trello 的秩序，AFFiNE 的自由
          </div>
          <h1 className="max-w-xl text-[34px] font-semibold leading-[1.25] tracking-tight text-ink">
            把计划与灵感
            <br />
            放在同一张画布上
          </h1>
          <p className="mt-4 max-w-md text-[13.5px] leading-6 text-muted">
            看板管理日程进度，无限画布承载流程图、结构图与文档。所有成员共享同一份数据，改动实时同步。
          </p>

          <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
            {features.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-line bg-surface/75 p-3.5 backdrop-blur transition hover:border-brand/30"
              >
                <div className="flex items-center gap-2 text-brand">
                  {item.icon}
                  <span className="text-[12.5px] font-medium text-ink">{item.title}</span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-5 text-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 px-12 pb-10 text-[11px] text-faint">
          © {new Date().getFullYear()} MBoard · 为小团队与课程项目而生
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex w-full flex-col lg:w-[44%]">
        <div className="flex items-center gap-2 px-6 pt-6 lg:hidden">
          <BrandMark size={28} />
          <span className="text-sm font-semibold">{appName}</span>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[360px]">
            <div className="mb-8">
              <h2 className="text-[22px] font-semibold tracking-tight text-ink">登录工作台</h2>
              <p className="mt-1.5 text-[13px] text-muted">
                账号由管理员在配置文件中预置，登录后可访问全部共享内容
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                  用户名
                </label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="请输入用户名"
                  className="field h-10"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                  密码
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="field h-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((value) => !value)}
                    className="icon-btn absolute right-1 top-1 h-8 w-8"
                    aria-label={visible ? "隐藏密码" : "显示密码"}
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-[12.5px] text-danger">
                  {error}
                </div>
              ) : null}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
                {pending ? "正在登录" : "进入工作台"}
              </Button>
            </form>

            <p className="mt-8 text-center text-[11.5px] leading-5 text-faint">
              登录状态保留 7 天，可在左下角随时退出
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
