# anki-cli

独立 Rust 制卡工具，将 `anki-helper` 的单词/背诵字段、51 字段模板、稳定笔记标识、媒体打包、Markdown 导出和旧项目读取迁入可复用 CLI。模型连接与文本、图片、语音生成由 MindOS Flow 负责；本工具处理确定性的输入解析、字段合并、媒体映射、YAML 清单和 `.apkg`。不包含原来的 Web 服务、模型配置页或厂商 SDK。

## 构建与验证

```bash
cargo build --release --locked
cargo test --locked
cargo build --locked
node --test tests/node.mjs
```

构建产物为 `target/release/anki-cli`（Windows 为 `anki-cli.exe`）。默认模板随二进制嵌入，SQLite 与 bzip2 使用静态构建。Node 扩展仅依赖 Node 内置模块，宿主提供 Tool/Zod 工厂。

## YAML 打包契约

Flow 最终输出 **`anki.manifest.yaml` + `media/` + `deck.apkg`**。清单是打包输入，不是模型生成的执行脚本；Rust 校验版本、身份、文件名、路径和媒体摘要。参考 [最小清单](examples/anki.manifest.yaml)：

```yaml
version: 1
deck:
  id: 123456789
  name: 英语单词
output: deck.apkg
cards:
  - id: apple.json
    kind: word
    data:
      name: apple
      chn: 苹果
      audio: apple.mp3
media:
  - name: apple.mp3
    path: media/apple.mp3
    sha256: 可选的文件SHA256
```

`kind` 为 `word` 或 `recite`，`data` 使用原 WordData / ReciteData 字段。牌组 `id` 与卡片 `id` 构成稳定身份，修改内容后重复导出保留 GUID。媒体引用必须对应 `media.name`，输入路径与输出路径均相对清单目录，拒绝越界路径和符号链接逃逸。可选 `template` 指向同目录树内的自定义 51 字段 JSON 模板。所有媒体先核验，再流式写入临时 ZIP，完成后替换最终包；缺文件或校验失败保留旧包。

```bash
anki-cli validate examples/anki.manifest.yaml
anki-cli pack examples/anki.manifest.yaml
```

## 原项目迁移与导出

```bash
anki-cli init ./project --input words.txt
anki-cli merge ./project --input completed-cards.json
anki-cli merge ./project --input regenerated-cards.json --replace
anki-cli migrate ./project
anki-cli pack ./project
anki-cli pack ./project/anki.manifest.yaml
anki-cli md ./project --output cards.md
anki-cli pkg2md ./deck.apkg --output ./unpacked
```

`init` 接受逐行单词、`Unit N` 分组和 WordData JSON（兼容旧数字 Unit 标记），已有同名单词保持原样；文件名冲突拒绝写入。`merge` 只补缺失文本、保留手工修改、身份和扩展字段；`--replace` 显式替换文本，例句或配图描述改变时使对应媒体引用失效。`migrate` 读取 `word_json/`、`recite_json/`、`audio/`、`images/` 和 `.anki-deck-id`，生成清单；`pack <项目目录>` 兼容直接导出，首次成功后保存牌组 ID。原项目必须带齐引用的媒体，不再静默漏掉缺失文件。

`pkg2md` 面向本项目的 51 字段模板，读取 `collection.anki2` / `collection.anki21` / Zstd 压缩的 `collection.anki21b`，输出卡片 JSON、Markdown、可重新打包的清单及媒体。媒体索引使用传统 JSON 映射；不声明支持任意 Anki 模型或新版 protobuf 媒体索引。

## 接入 MindOS

宿主配置采用通用外部 Tool 模块加载，不需要将 Anki 实现加入平台内置工具：

```bash
export ANKI_CLI_BIN=/absolute/path/anki-cli
export MINDOS_TOOL_MODULES='["/absolute/path/anki-cli/node/extension.mjs"]'
```

在这两个环境变量下启动 Node 宿主（httpd 或 CLI）。扩展注册 `anki.prepare@1`、`anki.plan@1`、`anki.package@1`；浏览器和 Tauri 未安装此 Node 扩展时不具备 Rust 打包能力。

三个定义共同使用：

| 定义 | 用途 |
| --- | --- |
| [anki-generate.flow](flows/anki-generate.flow) | 文本或 JSON 入口，保留原 ID |
| [anki-from-image.flow](flows/anki-from-image.flow) | 教材图片 → 视觉转录 → 用户校对 → 公共制卡 |
| [anki-build.flow](flows/anki-build.flow) | 公共制卡，接收规范化的 WordData 数组，补全、媒体与打包 |

在 MindOS 中恢复/导入三个定义，并先发布公共流程；默认安装和系统恢复会准备公共流程的可调用版本。已安装旧版 `anki-generate` 不会被自动覆盖，需删除后显式恢复或导入更新。在入口表单绑定 `text`，按需绑定 `image` / `speech`；配图和语音默认关闭。图片入口还需绑定支持图片输入的 `vision` 聊天连接。最多 4 张 PNG/JPEG/WebP、合计 6 MiB；上传的原图作为持久输入保留，恢复时无需重新选择。识别后始终暂停供用户修改 JSON，校对提交前不会开始补全或打包。

两个入口通过 `builtin.flow@2` 将参数、连接槽传入公共流程，入口限制整次运行的并发和节点数。公共流程使用 `builtin.spawn` 的 `scope: local` 隔离动态媒体/打包节点；YAML 契约和 Rust 打包无需区分单词来自文本还是图片。

CLI 从入口所在目录读取同名子 `.flow`，请将三个文件保存在一起。图片参数为 `images: ["data:image/png;base64,..."]`，无需单独使用上传服务；CLI 等待校对时返回 3，通过 `respond <run-id> <request-id> --value '{"cards":[...]}'` 提交，再 `resume <run-id>`。运行快照已保存展开的公共流程，恢复不重新读取最新定义。

媒体连接必须配置兼容的媒体端点、能力声明和 API Key；填写所选语音模型支持的音色。本工具不增加豆包原生 TTS 或 macOS `say` 驱动。

流程为：输入 → Rust 预校验 → 模型补全 → Rust 确定性合并与规划 → 每卡片媒体节点 → Rust 清单与打包。预校验在模型请求前检查工具环境、身份和最多 20 张的批量限制。媒体作为持久 Task 资产返回，仅允许同一个 Flow 内的打包工具读取；输出采用工作区的原有写权限。每次打包保存到 `输出目录/<操作摘要>/`，保留之前的产物。打包回执核对包、清单和媒体摘要；缺少或损坏回执保留不确定状态，不自动重放写操作。工作区导出目前限制单包 128 MiB；独立 Rust CLI 没有该内存导出限制。

在 MindOS 主仓库可运行完整模拟端点验收：

```bash
cargo build --manifest-path tools/anki-cli/Cargo.toml --locked
node apps/cli/scripts/verify-anki-flow.mjs
```

验收两个入口实际生成 `.apkg`，检查图片识别后的暂停、跨进程校对/恢复、校正内容与媒体，以及恢复时不重复请求。未调用真实付费服务，也未自动打开 Anki 桌面应用做导入验收。
