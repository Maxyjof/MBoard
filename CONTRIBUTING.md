# 贡献指南

感谢你愿意为 MBoard 出力。下面是最小必要的环境、约定和提交流程。

## 环境要求

- Node.js ≥ 20，推荐 22 LTS
- npm：仓库带 `package-lock.json`，请统一用 npm，不要混用 pnpm / yarn
- 可选：Docker + Docker Compose，用于验证容器部署与自动更新链路

## 本地开发

```bash
npm install
cp .env.example .env                      # Windows PowerShell: copy .env.example .env
cp config/accounts.example.yml config/accounts.yml
npm run setup                             # prisma generate + db push + 种子数据
npm run dev                               # http://localhost:3000/mboard
```

服务默认挂在 `/mboard` 子路径下，由 `next.config.mjs` 的 `basePath` 控制，直接访问根路径会 404。

## 代码约定

- TypeScript 严格模式，不要用 `any` 逃逸；确实必要时写明原因
- 组件用函数组件 + hooks，状态尽量下沉到真正需要的地方
- 样式只用 Tailwind 和 `app/globals.css` 里的设计 token，不要写死颜色
- 单个文件控制在 1000 行以内，超了就按职责拆分
- 注释解释「为什么」，不复述「做了什么」
- 新增接口或改动数据结构时，同步更新本地 `docs/CONTRACT.md`（该目录不入库）

## 提交信息

使用约定式提交前缀：`feat` `fix` `docs` `chore` `refactor` `test` `perf`。

- 中文或英文都可以，同一次提交内保持一致
- 一次提交只做一件事，便于回滚和 review

## 分支与 PR

1. 从 `main` 切分支，命名 `feat/简短描述` 或 `fix/简短描述`
2. PR 描述写清楚三件事：为什么改、改了什么、怎么验证
3. CI 必须通过（依赖安装 + Prisma 生成 + 类型检查 + 构建）
4. 涉及界面改动的，附上改动前后的截图

## 测试

仓库里的 `tests/` 与 `scripts/*-e2e.mjs` 需要本机 Chrome 和已启动的服务，具体命令见 [README 的验证脚本一节](README.md#验证脚本可选)。

## 许可证

提交代码即表示你同意以 [MIT 许可证](LICENSE) 授权你的贡献。
