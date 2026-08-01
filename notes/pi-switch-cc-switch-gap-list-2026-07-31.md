# Pi Switch 与 CC Switch 差距清单

本清单用于按使用价值推进 Pi Switch 的桌面体验，不复制 CC Switch 的代码、品牌或资源。

## 已覆盖

- Provider 添加、编辑、删除、切换和真实连接测试。
- Provider 添加表提供不含凭据的常用端点模板，并可从固定 GitHub HTTPS 目录显式同步；同步只更新独立缓存，UI/桥接层继续拒绝新增同名覆盖。
- Provider 复制：复制 Base URL、API 类型和模型定义；不解析或回传 API Key，沿用原密钥引用。
- API Key 在 macOS Keychain 中保存、读取、显示、修改，以及明文配置提示。
- 模型增删改、默认模型切换、服务端模型同步和缺失模型详情。
- 模型表单可直接编辑上下文、最大输出、Reasoning、文本/图片输入、来源和成本。
- 模型批量编辑：可按当前筛选结果选择多个模型，并只统一覆盖勾选的上下文窗口、最大输出、输入类型或 Reasoning 字段。
- 连接测试原始错误、结构化中文诊断、阶段耗时、服务端返回模型差异和最近 5 次无密钥历史。
- MCP、Skills、Agents、Profiles 的分层列表和状态检查。
- 配置锁、备份、原子写入、Pi schema 校验和 Tauri 启动工作目录处理。
- CC Switch 导入在 macOS 桌面端默认迁移密钥到 Keychain，明文导入必须显式关闭安全选项。
- 配置脱敏导出和恢复预览；同名 Provider 保留现有密钥引用，新 Provider 不带密钥写入。
- Provider 的编辑、复制、密钥轮换和删除收进“更多”菜单，测试/同步保持一键可见。
- 模型能力来源：服务端声明、模型族推断和未知状态分开保存；未知图片能力不再默认为仅文本，未知 Reasoning 在 UI 中显示为待确认。
- 已知能力修复：Models 页面可只修复明确模型族的旧行，保留手动覆盖；当前 `grok-4.5`、`kimi-k3` 和 `qwen3.8-max-preview` 旧行已通过锁/备份/schema 校验迁移。

## 仍待迭代

| 优先级 | 方向 | 当前缺口 | 建议验收 |
| --- | --- | --- | --- |
| P1 | Provider 预设 | 固定官方目录同步、严格 schema、缓存指纹和内置回退已覆盖；远程目录内容仍需随公开端点变化人工维护 | 目录更新必须通过无凭据/schema/内置镜像测试，Provider 表单仍允许完全自定义 |
| P1 | 模型能力 | 批量编辑已覆盖上下文、最大输出、输入类型和 Reasoning；成本、来源和模型 ID 仍保持逐项编辑，避免误改计费与标识 | 批量编辑不改变未选字段，保存前显示影响范围，能力字段被显式标为手动确认 |
| P1 | 操作反馈 | 连接测试已有真实对话/模型列表阶段和历史；同步、Doctor 仍缺少网络阶段说明 | 各操作显示可区分的进行中/成功/失败状态和可读错误 |
| P2 | Provider 卡片 | 低频操作已收进更多菜单；暂无拖拽排序和批量动作 | 常用动作一键可见，低频动作收纳且仍有 tooltip |
| P2 | 导入导出 | CC Switch 导入与 Pi 脱敏导出/恢复已覆盖；暂不迁移密钥值 | 导出前脱敏，导入前预览，恢复使用现有备份机制 |
| P2 | 列表体验 | Provider/模型搜索已存在，超长列表还没有虚拟化或分组 | 长列表滚动稳定，空/错/加载状态一致 |
| P3 | 运行历史 | 已提供最近 5 次连接测试摘要，尚无趋势图和手动清理入口 | 只保存无密钥的摘要，支持清理和关闭 |

## 模型映射专项

CC Switch 的历史 Codex catalog 生成确实出现过能力声明问题：旧版本可能从共享 `models_cache.json` 复制缺省字段，并把未知模型的 `input_modalities` 保守地落成仅文本；Codex 还会因为缺少 `supports_reasoning_summaries` 这类解析必需字段而拒绝整个 catalog。新版本已在生成器中补齐解析必需字段，并对图片能力采用“确认的文本模型保持 text，其余未知放宽到 text+image”的策略。

Pi Switch 不生成 Codex catalog，而是写 Pi 的 `models.json`。本轮将同一原则落到 Pi 层：`reasoning`、`input` 是运行时字段，`capabilities` 保存证据级别；同步接口会读取服务端能力提示，CC Switch 导入只保留明确的图片/布尔推理线索并标为 `inferred`，旧目录的 `input_modalities: ["text"]`、`supported_reasoning_levels`、`default_reasoning_level` 和 `supports_reasoning_summaries` 不会被当成已确认能力。无法确认时不会显示为“关闭/仅文本”。

## 本轮验收

- 复制动作在核心层使用现有 models.json 锁、备份和 schema 校验。
- 复制结果只返回来源、目标、API、模型数量和密钥存储类型，不返回密钥值。
- 复制目标名称支持 Unicode 字母/数字，并拒绝空名、非法字符、同名和已存在名称。
- 连接测试在真实对话成功后单独检查模型列表；列表接口缺失时显示“已接通、模型列表未知”，不误报为连接失败。
- 配置导出明确移除 `apiKey`、headers 和常见凭据字段；恢复前用同一 schema 做预览，写入继续走锁和备份。
- 连接测试历史只保留最近 5 条阶段摘要，不持久化原始错误文本。
- 未自动提交或推送 GitHub。

## 2026-07-31 能力映射回归轮

- Doctor 弹窗新增本地检查与网络模型列表检查的独立状态、加载态和错误态；网络检查结果通过不可变 React state 更新，不再直接修改 modal 对象。
- 模型同步预览现在同时列出新增模型和已有模型的服务端能力声明；应用同步时只刷新服务端明确返回的字段，`manual` / `confirmed` 能力锁保持不变。
- 能力推断补充精确的 confirmed text-only registry（包括 `deepseek-v4-pro` / `deepseek-v4-flash`）；未知的新后缀继续对图片能力 fail-open，避免旧 catalog 的默认 `text` 把新模型误判成纯文本。
- 新增回归覆盖：服务端能力刷新、手动/已确认锁保护、精确纯文本型号与未知后缀的区别，以及 `supports_reasoning_summaries` 不被误判为模型推理能力。
- 模型编辑器只有在用户明确修改输入类型或 Reasoning 时才写入 `manual` 能力锁；编辑上下文、成本或来源不会把旧的错误映射永久锁死。
- 桌面端在 `640x520` 下将 Model/MCP 长列表切换为可读的卡片式布局；Provider、Model、MCP 表单统一使用弹窗内部滚动，底部操作不会被窗口裁切。
- 直连 `act(...)` 的 Thinking、模型、MCP、Skills、Profiles 操作统一收口 Promise 错误，桥接失败会进入现有 Toast，不再产生 `unhandledrejection`。
- 2026-07-31 验证：`npm test` 118/118、`npm run build:web`、`npm run build:desktop -- --bundles app`、`codesign --verify --deep --strict`、`git diff --check` 均通过；Playwright 已检查 `640x520`、`900x620`、`1180x760`，最新 console error 为 0；打包 `.app` 已实际启动并保持进程运行。未自动提交或推送 GitHub。

## 2026-08-01 批量模型编辑

- Models 页面支持单选、取消选择和“选择当前筛选结果”；切换 Provider 时会自动清空选择，避免跨 Provider 误操作。
- 批量弹窗会展示所有受影响的模型；未勾选字段不会被写入。上下文、输入类型和 Reasoning 会记为 `manual` 能力证据，后续服务端同步不会覆盖它们；最大输出仅更新数值。
- 核心层会在一次配置锁写入中验证全部模型存在性和字段合法性。空选择、未知模型、非法 Token 数值、非法输入类型和未授权字段均会拒绝，失败不会留下部分更新。
- 2026-08-01 验证：`npm test` 120/120、`npm run build:web`、`npm run build:desktop -- --bundles app`、`codesign --verify --deep --strict`、`git diff --check` 均通过。Playwright 在 `1280x800` 和 `640x520` 使用 mock 数据覆盖弹窗打开、禁用保存、选择字段、保存反馈、筛选清除和控制台 error 检查（0 error）。
- 桌面包仍是 arm64 的 ad-hoc 签名；没有 Apple notarization。超长模型列表虚拟化仍是后续独立增强，不与本次模型配置写入混合。

## 2026-08-01 远程 Provider 模板目录

- Provider 工具栏新增模板目录弹窗，显示当前来源、目录版本、上次同步时间、内容指纹和模板变更；可显式同步官方目录或还原应用内置模板。
- 远程地址固定为本项目 GitHub Raw HTTPS 清单，生产桥接不接受用户传入 URL；请求不携带本机 Provider、API Key 或 Authorization header，并拒绝重定向和超限响应。
- 目录使用版本化严格 schema，只允许公开表单默认值；未知字段、凭据字段、非 HTTPS Provider 端点、重复模板、未知 API 类型或无效缓存指纹会让远程目录失效并自动回退内置模板。
- 同步只写 `~/.pi/agent/pi-switch-provider-catalog.json`，不会修改 `models.json`。清除缓存前会保留现有备份，添加 Provider 仍需要用户确认表单并单独提供 API Key。
- 2026-08-01 验证：`npm test` 124/124、`npm run build:web`、`npm run build:desktop -- --bundles app`、`codesign --verify --deep --strict`、打包资源检查和 `git diff --check` 均通过；凭证模式扫描 0 命中。Playwright 在 `1180x760` 与 `640x520` 覆盖初始状态、同步预览、ISO 时间显示、还原内置模板和固定底部操作栏，最新 console error 为 0。
