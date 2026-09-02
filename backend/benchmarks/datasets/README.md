# 外部评测数据集说明

仓库支持 WildReceipt 与 PaddleOCR 增值税发票数据集。数据文件保存在本地，不提交到 Git。

## WildReceipt

- 下载地址：<https://download.openmmlab.com/mmocr/data/wildreceipt.tar>
- 官方文档：<https://mmocr.readthedocs.io/en/latest/user_guides/data_prepare/datasetzoo.html#wildreceipt>
- 已发布归档中的内容：1,267 条训练标注、472 条测试标注和 1,765 个 JPEG 文件
- 归档文件 SHA-256：`f47646e16033d95c85a0b3a180a39d90cc354a729e51a280211b2fe7cae532bd`
- 许可说明：MMOCR 数据集文档未明确列出 WildReceipt 的单独许可。项目仅将其用于本地研究和评测；在确认数据权利前，不重新分发归档或图片。

在后端目录中下载并准备数据：

```powershell
pnpm dataset:wildreceipt
```

运行可复现的 50 张票据评测：

```powershell
pnpm benchmark:real -- --limit=50 --phase=all --seed=20260831
```

评测脚本支持断点续跑，分别统计票据识别、Agent 审核和端到端规则一致性。逐条输出保存在 Git 忽略目录中。

## PaddleOCR 增值税发票

- AI Studio：<https://aistudio.baidu.com/datasetdetail/165561>
- 官方说明：<https://www.paddleocr.ai/v2.10.0/en/applications/发票关键信息抽取.html>
- 标注包：`zzsfp.tar`，98.67 MB
- SHA-256：`b65bf3b6639758fe98c2c076fbc5b527006a66f01616c2fbe4d36ab06a1a1a1f`
- 有结构化标注的图片：38 张（训练集 30 张、验证集 8 张）
- AI Studio 页面许可标记：CC BY-SA；原始图片和标注包不随仓库分发

登录 AI Studio 下载 `zzsfp.tar` 后，在后端目录执行：

```powershell
pnpm dataset:paddle-vat -- --archive="C:\path\to\zzsfp.tar"
pnpm benchmark:paddle-vat -- --limit=38 --phase=all --ocr-max-edge=1536 --run-id=paddle-vat-real-n38-v1
```

适配器依据 question-answer linking 还原金额、税额、日期、发票号码和购买方名称。上游标注不包含销售方名称与发票代码，这两个字段不计算准确率。
