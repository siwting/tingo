# 听记与 Tingo 融合版

桌面 App 保留 Tingo 的 Tauri/Rust 架构、录音、声纹、鱼骨图及导出。新增的名词库、问答、待办、纠错、洞察和自动投递也由 Rust 后端提供。

## App 与 Web

App 提供完整编辑和处理功能。Web **只查看会议记录**：列表、全文搜索、纪要、待办、洞察、原文与录音回听。Web 没有设置、新建会议、录音、导入、编辑或删除接口；只读服务不启动自动投递线程。两端共用 `TINGO_ROOT`（默认 `~/Documents/Tingo`）。

```sh
cd app
pnpm install --frozen-lockfile
pnpm build
cargo build --manifest-path engine/Cargo.toml --example serve
cd ..
./scripts/run-web.sh
```

默认地址 `http://127.0.0.1:8768`。在已信任的局域网或 Tailscale 地址上提供查看服务：

```sh
TINGO_WEB_HOST=你的本机局域网或Tailscale地址 ./scripts/run-web.sh
```

其他设备访问 `http://该地址:8768`。只读不是身份验证：能连上该监听地址的设备可以查看会议，请使用已有的私有网络。不要将此端口直接发布到公网。

`serve --desktop-api` 仅供本机开发和自动化验收，非回环地址拒绝启动；生产 Web 不使用这个选项。

## 识别与内容整理

原有 Paraformer、SenseVoice、Fun-ASR-Nano、Apple Speech 保留。新增 Qwen3-ASR MLX，使用 Tingo 的音频解码、VAD、CAM++ 和统一聚类；MLX 只替换识别步骤。它是可选组件，需要 Apple Silicon、可用的 Metal、Python `mlx-audio`/`soundfile` 和已下载的 Qwen3-ASR MLX 模型。

```sh
export TINGO_MLX_HELPER="$PWD/scripts/tingo-mlx"
export TINGO_MLX_PYTHON="你的MLX虚拟环境/bin/python"
export TINGO_MLX_MODEL="你的Qwen3-ASR模型目录"
```

从继承这些环境变量的终端启动 App，再在识别模型中选择 Qwen3-ASR MLX。首次需准备 Tingo 共用的声纹/VAD 模型。模型文件不复制进 Git，也不隐式替换现有引擎。

内容整理保留 OpenAI 兼容接口、Anthropic 与 Ollama；设置新增 Codex CLI。选择 Codex 预设后可将模型留空，使用 CLI 默认模型，无需 API Key；需要已有 `codex login`。可用 `TINGO_CODEX_BIN` 指定可执行文件。转写文本会发给所选服务；音频在本机处理。CLI 接入使用临时目录、只读沙箱、不加载用户配置并关闭工具，依据[官方非交互文档](https://learn.chatgpt.com/docs/non-interactive-mode)。

## 融入原有页面的功能

入口：跨会议问答在会议列表，单场待办/洞察/纠错/问答在会议详情的「待办与分析」，名词库在设置「热词」，监视目录在设置「自动导入」。没有独立的工作台导航。新增桌面文案跟随中英文设置。

- 正式名称、真实称呼作为热词；错误写法独立保存。最多启用 100 个名称/称呼、3000 字。原有热词设置仍可用，推理时合并去重。
- 单场纠错保留 `transcript.original.json`，同步转写 Markdown、纪要和已有待办文字；完成状态及日期不变。原纪要进入历史记录。
- 待办可编辑、确认和勾选完成。生成纪要后尝试提取有原文依据的待办与独立洞察；失败保留纪要和原文，可在会议详情手动重试。重新生成不替换已保存的人工任务与洞察。
- 单场/跨会议问答逐批检查已有转写；引用必须逐字匹配原文，支持回听跳转。结果保存在 `questions.json`。多批资料显示分批答案，不冒充一次完整推理。
- 智能标题与分类由 App 手动触发，分类合并进原有标签。
- 自动投递目录由 App 配置，支持语音备忘录目录及自选音视频目录；目录访问沿用 macOS 权限。递归扫描、忽略隐藏文件/软链接，稳定 120 秒且未占用后导入。每 15 秒扫描，失败 5 分钟后重试，最多 3 次。源文件保留，Tingo 保存导入副本。已有转写时重试只生成内容。
- 任务状态写入 `jobs.json`；中断任务在重启后显示为可重试错误，已保存原文保留。自动投递另有持久化去重/重试记录。

## 旧数据迁移

```sh
tingo import-workbench /path/to/meetings/.state/workbench.sqlite3 /path/to/Tingo
```

源库以只读一致性事务读取，含 WAL；每场转换到原生 `transcript.json`/`meta.json`/`workbench.json`，保留完整源行、人工确认、完成状态、问答和最初原文快照。重复导入跳过已有目录，不覆盖人工修改。全局词库与问答另存源快照。此命令不复制录音、不重新转写、不自动清理源库。

## 验证命令

```sh
pnpm --dir app build
cargo test --manifest-path app/engine/Cargo.toml --lib
cargo build --manifest-path app/engine/Cargo.toml --example serve
python tests/integration/test_native_workbench.py
PYTHONPATH=src python tests/test_workbench_import.py
```

HTTP 集成测试只使用临时目录与本地模拟模型。`check_codex`、`check_mlx` 示例是显式的真实运行检查，不在普通单元测试中发送请求或下载模型。长会议、重叠发言和远程网络稳定性需按真实使用情况继续验证。

正式 App 从 Finder 启动时使用 `~/Documents/Tingo` 和 `~/.config/tingo/config.toml`；仍兼容旧 jiyao 目录。`TINGO_ROOT` / `TINGO_CONFIG` 仅在显式设置时覆盖。验收用临时目录不是正式库，旧听记库也不会自动迁移。
