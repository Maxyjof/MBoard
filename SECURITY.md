# 安全策略

## 报告漏洞

请**不要**用公开 issue 报告安全问题。

使用 GitHub 的私密漏洞报告：仓库 **Security** 标签页 → **Advisories** → **Report a vulnerability**。描述里尽量包含复现步骤、影响范围和你的环境。

维护者会尽快确认并回复处理进度。

## 支持范围

只维护 `main` 分支上的最新代码。

## 自行部署时的注意事项

- `.env` 里的 `AUTH_SECRET` 必须替换成足够长的随机字符串，不要沿用模板值
- `config/accounts.yml` 属于本机私有配置，已经在 `.gitignore` 中，不要提交
- 账号密码生产环境建议用 bcrypt 哈希，不要写明文
- 经 HTTPS 反向代理对外时设置 `COOKIE_SECURE=true`
- 自动更新容器挂载了 `docker.sock`，只应在自己完全信任的宿主机上启用
