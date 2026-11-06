# 融合版验证记录

日期：2026-11-05。全部测试使用临时目录或内置虚构演示录音，没有修改现有听记会议库。

| 验证 | 结果 |
| --- | --- |
| TypeScript / Vite 生产构建 | 通过 |
| Rust 引擎单元测试 | 82 项通过 |
| Rust HTTP 集成测试 | 11 项通过 |
| Python 服务、配置、CLI、只读边界和迁移兼容性 | 62 项通过；1 项 FunASR 慢速测试另列环境限制 |
| macOS Tauri App | debug bundle 构建及临时数据启动通过，ad hoc 签名 |
| MLX 真实推理 | 12 秒演示录音经 Rust VAD → MLX → CAM++ / 聚类完成 |
| Codex CLI 真实请求 | 固定虚构会议内容生成通过 |
| App 工作台实际操作 | 名词库添加、纠错、任务及确认状态保存、重载通过 |
| Web 实际浏览 | 只读列表、标题搜索、详情与窄屏布局通过 |

## 边界验证

Rust HTTP 测试覆盖名词库冲突、纠错原文快照、任务完成状态保留、问答逐字引用校验、洞察生成、自动投递恢复、Codex 配置、路径校验和只读 HTTP 路由。模拟模型测试不代表真实模型语义质量。自动投递测试预置稳定时间，再等待实际扫描线程；未用真实文件等待完整 120 秒。

Web 独立启动只读路由，不注册设置、创建、导入、删除、录音、AI 生成等接口，不启动自动投递。直接请求受限接口返回 404/405（Rust）或 403（Python）。输入编辑页面地址仍显示记录浏览界面。

## 未覆盖及环境限制

- 长会议、重叠发言和多人区分准确率尚未做真实会议验收；12 秒识别可运行但仍出现个别同音字错误。
- 本轮未申请麦克风/屏幕录制权限、未在另一台设备测试远程网络，也未配置公网访问。
- App 是本机测试构建，未做 Apple notarization。
- 旧 Python CLI 的 FunASR 慢速端到端测试在现有共享环境中失败：缺失 `funasr.layers` / `funasr.utils.modelscope_file`，模型未注册。新 App 使用 Rust 引擎，不依赖该 Python FunASR 路径。
- 旧库迁移仅在合成 SQLite 数据上测试；真实会议库未迁移，迁移命令不复制录音。

使用与部署步骤见 [FUSION.md](FUSION.md)。

## 界面融合修正验收

- Codex 预设点击、保存、保存后高亮及协议持久化已在真实界面验证；无需地址和密钥的字段隐藏。
- 英文模式的 Qwen 文案、缺失本地环境提示、会议详情待办与问答均已检查；待办完成状态保存后切换标签仍保留。
- 独立工作台导航移除；功能分别进入会议列表、单场详情、热词及自动导入设置。
- Storage 说明色条为 Tingo 文件组成，并移除零字节仍占宽度的显示错误。
- 清除验收目录环境覆盖后，实际桌面 App 的 About 显示用户的 `Documents/Tingo` 和 `.config/tingo/config.toml`。验收服务均已关闭，正式库为空，旧听记数据未迁移。
- 后续 MLX 下载改版已替换“未配置时拒绝下载”回归，覆盖新模型目录、未安装状态和模型列表。

CLI 分类调整：实际界面验证两种 CLI 选择保存、切换到 Claude API 后隐藏 CLI 选项；Claude Code CLI 通过 Rust 使用虚构材料完成真实调用。新增成功/错误/空响应解析测试，配置与英文提示 HTTP 回归通过。

## 模型下载、自动导入与目录修正（2026-11-05）

- Rust 单元测试 84 项、HTTP 集成测试 12 项通过；覆盖空库自动导入默认值、MLX 下载列表、目录保存持久化、忙碌拒绝和旧会议保留。
- 前端类型检查和 macOS debug bundle 构建通过。正式库已补入旧语音备忘录监听路径及 1 条有效名词记录，原文件变更前保留备份。自动导入保持关闭。
- 复用既有 0.6B 模型和 Python 环境，在实际模型目录通过合成音频的 Rust 解码 → VAD → MLX → CAM++ / 聚类。
- 浏览器中的同版界面已检查会议问答折叠/展开间距、监视路径、已保存名词列表及存储目录控件。独立 Web 仍为只读。
- 空临时目录冷启动验证通过：自动安装 Python 3.12 / mlx-audio，完整下载官方 0.6B 权重与共用组件，再完成合成音频的真实推理。Xet 通道停滞后改为普通 HTTPS，下载重试完成。1.7B 已核对官方仓库与容量，本轮未下载验证其推理。
- 当前 macOS 已锁屏；桌面 App 曾在 Documents 文件访问处阻塞，系统授权提示无法由本轮自动化处理。解锁并确认文件夹访问后，仍需重启最新 App 完成原生窗口最终验收；不将浏览器验收替代这一项。

### 文件夹授权后的复核

用户确认允许访问后，实际桌面 App 首页与设置页恢复加载，中文界面和 Codex CLI 状态正常。用户已将会议目录改为 `~/Tingo`；当前 App 的会议、存储、模型、自动导入和名词接口均可读取，无超时。原监听目录及 1 条名词已合并补入新库，保留当前开关和原库。0.6B MLX 为已安装/使用中，1.7B 为未安装。用户正在操作窗口，本轮未继续切换页面；其他页面视觉布局沿用前述同版浏览器验收记录。

## 保存目录切换与真实旧库迁移

- 全局监听设置、名词及去重状态固定在配置旁的 `workbench/`，不再随会议目录切换。迁入时不覆盖现有值，清空设置后切回旧库不会复活旧值；禁止把会议库设到监听目录内部。
- Rust 85 项通过；HTTP 12 项原有测试通过，新增真实进程重启测试通过（合计 13 项）；迁移/CLI 非慢速测试 8 项通过。旧 Python FunASR 慢速测试仍因既有缺失依赖失败，未计入通过项。前端构建及 Tauri bundle 通过。
- 实际旧听记 25 场记录迁至 `~/Tingo`：24 场已有转写、1 场原本处理失败；保留 229 条待办、2 条问答、说话人名称和完整源行。约 1.87 GB 录音逐份校验 SHA-256；24 份旧导出及历史备份另存 `.migration/tingji-2026-11-05/`，含完整 SQLite 一致性快照和校验清单。
- 新版真实 App 显示 25 场，接口确认全局设置和问答可读取；录音 HTTP Range 返回 206，清理后会议数量不变且无重复导入任务。自动导入保留用户开启状态。
- 校验后将旧数据库、旧导出、旧备份、旧监听启动项及旧位置副本移入系统废纸篓；旧后台服务已停止。22 份系统语音备忘录原录音全部保留。

## 2026-11-05 Meeting detail tabs and task layout

- Split legacy embedded `AI 分析与建议` sections for display only; keep original minutes and exports intact. Desktop now has separate Minutes, Transcript, AI analysis, Tasks tabs. The reader uses the same split and displays analysis once, preferring the workbench's latest insights with legacy fallback.
- Tasks use multiline auto-height textareas, labelled owner/deadline fields and responsive spacing. Deadline is text so relative deadlines survive edits and empty deadlines do not resemble today's date.
- `node --test app/tests/analysis.test.mjs`: 3 passed (Chinese/English headings, next-section preservation, fenced content and empty input).
- TypeScript check, Vite build and debug macOS bundle passed. Native app navigation verified separate tabs, long task content and existing analysis loading. No AI regeneration was invoked and no meeting data was changed during verification.

### Reading layout follow-up

- User-requested tab order: Minutes → AI analysis → Tasks → Transcript.
- Analysis now uses the same `card doc`/Markdown rendering as minutes, including legacy category headings and bullet lists.
- Replaced the editable task form with a read-only numbered list, owner/deadline metadata and textual completed status. Removed task checkboxes and editing actions from this pane.
- Four frontend helper tests, TypeScript/Vite build and debug macOS bundle passed. Restarted the native app and visually verified both analysis and read-only tasks with existing meeting content.

## 2026-11-05 Restore model choices and add MLX engines

- All eight catalog entries remain visible, including uninstalled original Paraformer/SenseVoice/Fun-ASR-Nano ONNX models. Restored their native download paths and labelled ONNX explicitly.
- Added independent SenseVoice Small MLX and Fun-ASR-Nano MLX identifiers, selection, readiness, managed downloads and inference. Fun-ASR uses the upstream `fun_asr_nano` checkpoint compatible with pinned mlx-audio 0.6.1, not the incompatible mlx-audio-plus `funasr` 8-bit checkpoint.
- Downloader includes SenseVoice normalization/BPE assets and nested Fun-ASR tokenizer assets, checks required assets before completion, and runtime setup includes sentencepiece. SenseVoice receives language codes; autoregressive engines receive mapped language names.
- Downloaded both new models into the existing App model directory. Both passed real synthetic Chinese speech through native decode/VAD/MLX/CAM++/clustering. Long meeting accuracy/performance was not benchmarked.
- 86 native tests passed outside sandbox (the sandbox cannot perform the AAC encoder test). Extended model status test separately verifies all models are visible before installation, unready models cannot be selected, and both new installed model IDs can be selected and persist.
- TypeScript/Vite build and debug App bundle passed. Restarted App; settings shows eight models, both newly installed MLX models offer Use, all three original ONNX models offer Download. Current Qwen selection retained.

## Upstream v0.5.2 merge (2026-11-06)

- Merged official `tancheng33/tingo` main at `fa4caa5` (v0.5.2); preserved the read-only browser router, eight ASR choices, CLI providers and meeting analysis/task layout.
- Adopted live meeting-folder switching and verified copying. Workbench inbox, questions and job persistence now follow the active root. Global settings are initialized before switching and watched-folder recursion is rejected. New config storage selection takes priority over legacy `library.json`; the legacy API remains compatible.
- Retained native updater implementation, but custom builds reject official-binary check/download/install commands: installing an upstream binary would discard this branch's workbench features. Future custom releases need a separate update distribution.
- Validation: 91 existing Rust tests passed (AAC test rerun outside sandbox), plus the new live-switch regression; 56 Python config/server tests and five frontend tests passed. TypeScript/Vite and final debug macOS App build passed; bundle version is 0.5.2 and codesign verification passed.
- Built artifact: `app/src-tauri/target/debug/bundle/macos/Tingo.app`. This merge did not replace the installed App, exercise real-library switching, or perform a new device transcription test. Local signing only; no Apple notarization.
