"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionUser } from "@/lib/auth/token";

type AccountSettingsProps = {
  user: SessionUser;
};

// 账号设置：显示名 / 登录密码
export function AccountSettings({ user }: AccountSettingsProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(user);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const profileChanged = displayName.trim() !== profile.displayName;

  async function saveProfile() {
    const name = displayName.trim();
    if (!name) {
      toast.error("显示名不能为空");
      return;
    }
    if (name.length > 24) {
      toast.error("显示名最多 24 个字符");
      return;
    }
    if (savingProfile) return;

    setSavingProfile(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const data = (await response.json()) as { user?: SessionUser; error?: string };

      if (!response.ok || !data.user) {
        toast.error(data.error || "保存失败");
        return;
      }

      setProfile(data.user);
      setDisplayName(data.user.displayName);
      toast.success("资料已更新，协作光标会显示新名字");
      router.refresh();
    } catch {
      toast.error("网络异常，请稍后再试");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (savingPassword) return;

    if (!passwords.current) {
      toast.error("请输入当前密码");
      return;
    }
    if (passwords.next.length < 6) {
      toast.error("新密码至少 6 位");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.next,
          confirmPassword: passwords.confirm,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        toast.error(data.error || "修改密码失败");
        return;
      }

      toast.success("密码已修改，下次登录请使用新密码");
      setPasswords({ current: "", next: "", confirm: "" });
    } catch {
      toast.error("网络异常，请稍后再试");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-surface px-5">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">账号设置</h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            管理你的显示名和登录密码
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-muted sm:inline-flex">
          <ShieldCheck className="h-3 w-3 text-success" />
          已登录
        </span>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-7">
          {/* 个人资料 */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <UserRound className="h-4 w-4 text-brand" />
              <h2 className="text-[13px] font-semibold text-ink">个人资料</h2>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div className="flex items-center gap-3">
                <Avatar name={displayName || profile.displayName} color={profile.color} size={48} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {displayName.trim() || profile.displayName}
                  </p>
                  <p className="text-[11.5px] text-faint">@{profile.username}</p>
                </div>
              </div>

              <div>
                <label htmlFor="displayName" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                  显示名
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={24}
                  placeholder="其他成员在协作光标上看到的名字"
                />
                <p className="mt-1.5 text-[11px] text-faint">
                  会显示在画布协作光标、在线成员和操作人中，最多 24 个字符
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
                <Button
                  variant="ghost"
                  disabled={!profileChanged || savingProfile}
                  onClick={() => {
                    setDisplayName(profile.displayName);
                  }}
                >
                  重置
                </Button>
                <Button
                  variant="primary"
                  loading={savingProfile}
                  disabled={!profileChanged}
                  onClick={() => void saveProfile()}
                >
                  保存资料
                </Button>
              </div>
            </div>
          </section>

          {/* 修改密码 */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <KeyRound className="h-4 w-4 text-brand" />
              <h2 className="text-[13px] font-semibold text-ink">修改密码</h2>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor="currentPassword" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                  当前密码
                </label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={passwords.current}
                    onChange={(event) =>
                      setPasswords((prev) => ({ ...prev, current: event.target.value }))
                    }
                    placeholder="输入当前使用的密码"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="icon-btn absolute right-1 top-1 h-8 w-8"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="newPassword" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                    新密码
                  </label>
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={passwords.next}
                    onChange={(event) =>
                      setPasswords((prev) => ({ ...prev, next: event.target.value }))
                    }
                    placeholder="至少 6 位"
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                    确认新密码
                  </label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={passwords.confirm}
                    onChange={(event) =>
                      setPasswords((prev) => ({ ...prev, confirm: event.target.value }))
                    }
                    placeholder="再次输入新密码"
                  />
                </div>
              </div>

              <p className="text-[11px] leading-5 text-faint">
                修改后的密码保存在数据库里，会覆盖配置文件中的初始密码；当前登录状态不受影响
              </p>

              <div className="flex items-center justify-end border-t border-line pt-4">
                <Button
                  variant="primary"
                  loading={savingPassword}
                  onClick={() => void savePassword()}
                >
                  更新密码
                </Button>
              </div>
            </div>
          </section>

          {/* 账号信息 */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <ShieldCheck className="h-4 w-4 text-muted" />
              <h2 className="text-[13px] font-semibold text-ink">账号信息</h2>
            </div>
            <dl className="divide-y divide-line text-[12.5px]">
              <div className="flex items-center justify-between px-5 py-3">
                <dt className="text-muted">用户名</dt>
                <dd className="font-mono text-ink">@{profile.username}</dd>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <dt className="text-muted">账号来源</dt>
                <dd className="text-ink">config/accounts.yml</dd>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <dt className="text-muted">数据权限</dt>
                <dd className="text-ink">所有成员共享同一份看板与画板</dd>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <dt className="text-muted">新增账号</dt>
                <dd className="text-ink">由管理员修改配置文件后重启服务</dd>
              </div>
            </dl>
          </section>

          {savingProfile || savingPassword ? (
            <p className="flex items-center justify-center gap-2 pb-2 text-[11px] text-faint">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在保存
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
