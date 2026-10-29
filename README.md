# 梗百科 · dsh-memewiki

把 [astrbot_plugin_memewiki](https://github.com/in1t1a1/astrbot_plugin_memewiki) 搬到了 DSH 上：同一个 6668 条梗词库，同一套查词逻辑，换成了 Harness 的工具、上下文注入和设置页。

## 它做什么

- **`search_meme_wiki` 工具**：模型遇到没把握的新词、缩写、黑话，可以自己查。返回「怎么用 / 怎么接」「出处」「标签」，查不到会明确返回 `found=false`，不会编。
- **自动预查注入**：每条用户消息进来时，插件先判断「这是不是在说一个词」，命中就同步查本地词库（毫秒级、不联网），把词条作为上下文递给模型。查不到就什么都不加，不占 token。
- **常驻用法提示**：一段约 150 token 的固定要求——先查、别科普、查不到就说不知道、别说客服腔。设置页里可以整段替换，开关即时生效，不用重启。
- **设置页「梗百科」**：开关、预查词长上限、自定义提示词、查词测试、自建黑话增删。查词测试走的和模型是同一条路径，看到的就是模型看到的。

## 设置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `preload` | `true` | 自动预查注入 |
| `guide` | `true` | 常驻用法提示 |
| `online` | `false` | 本地没有时去 cnmeme.wiki 问一次，只认完全同名的条目，近似的一律不要 |
| `maxQueryChars` | `10` | 预查时，一句话不超过多少字才当作词（2–20）；「晚上吃什么好呢」这类普通疑问句不会触发 |
| `guidance` | `""` | 自定义提示词，留空用内置文案 |

`brief=true` 的查词结果只保留用法，不带出处；设置页的「查一下」走同一条路径，但会显示出处。

## 安装

需要 DeepSeek Harness（`dsh` CLI 或桌面版），Node >= 22。

```bash
# 把仓库放到任意目录，然后用 CLI 把这个目录装进 profile（默认 desktop）
dsh plugin add ./dsh-memewiki
# 想装进别的 profile：dsh plugin --profile <名字> add ./dsh-memewiki
```

`dsh plugin` 只是把参数转给 pnpm，装的是 profile 目录；装完在插件页确认「梗百科」已启用，必要时重启 Harness。之后模型侧会多出 `search_meme_wiki` 工具和一段常驻用法提示，设置页会多出「梗百科」。

## 长什么样

| 设置页 | 原版的图片卡片（本项目未实现） |
| --- | --- |
| ![设置页](docs/settings.png) | ![原版卡片](docs/upstream-preview.png) |

原插件会把词条用 Pillow 渲染成卡片发到群里；这里改成纯文本，理由是不引原生图形依赖，而且模型接梗用不着图。


## 数据在哪

- 词库：包内 `data/memes.db`（只读打开，6668 条，快照日期见设置页）。
- 用户数据：`$DSH_HOME/memewiki/`（默认 `~/.dsh/memewiki/`）
  - `settings.json` 设置页开关
  - `terms.json` 自建黑话
  - `memes.db` 可选覆盖包内词库（放这里就优先用它）

## 开发

```bash
node test/smoke.mjs   # 不需要 Harness，假 ctx 跑通工具、注入和设置页路由
```

## 许可

MIT。词库与查词逻辑来自 astrbot_plugin_memewiki（MIT），词条内容来自 [cnmeme.wiki](https://cnmeme.wiki)。
