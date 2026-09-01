# 贡献指南

感谢关注 ExpensePilot Agent。请确保提交内容不包含真实票据、员工信息、访问令牌、模型权重或未经许可的数据集。

## 开发流程

1. 从 `main` 创建短生命周期分支，例如 `feature/add-policy-check`。
2. 修改前先明确输入、输出、权限边界和失败行为。
3. 不要让模型获得审批、付款、发信或任意文件执行权限。
4. 新增规则或 Guardrail 时补充单元测试；修复模型失败样本时补充回归用例。
5. 提交前执行：

```powershell
cd backend
pnpm test
pnpm typecheck
pnpm build

cd ../frontend
pnpm build
```

## Commit 约定

建议使用 Conventional Commits：

- `feat:` 新功能
- `fix:` 缺陷修复
- `test:` 测试改动
- `docs:` 文档改动
- `refactor:` 不改变行为的重构
- `chore:` 工具或依赖维护

## Pull Request

PR 应说明问题、方案、测试结果和安全影响。涉及模型输出变化时，请同时提供固定数据集上的前后对比，不要只提交单个成功示例。

## 数据要求

- 只提交合成数据或许可明确的公开数据适配代码。
- 外部数据集二进制必须保持在 `.gitignore` 中。
- 示例邮箱使用 `.example`，示例IP使用文档保留网段。
- 日志和截图在提交前必须去除账号、路径、Token和票据内容。
