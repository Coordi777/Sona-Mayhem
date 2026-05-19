<div align="center">

<img src="assets/Champie_Sona_profileicon.png" alt="Logo" width="140" height="140" style="border-radius: 8px;">

# Sona-Mayhem

*♫ Hexgates Mayhem Edition ♫*

基于 [Pengu Loader](https://pengu.lol/) 的英雄联盟客户端增强插件 ·【海克斯大乱斗专项 Fork】

[安装](#-安装) · [功能](#-功能特性) · [使用](#-使用) · [报告问题](https://github.com/Coordi777/sona-mayhem/issues)

</div>

---

> 本仓库 fork 自 [WJZ-P/sona](https://github.com/WJZ-P/sona)，在保留原 Sona **全部功能** 的基础上，**针对海克斯大乱斗（海斗）玩家** 新增战利品助手、大乱斗智能配装、海克斯 augment 速查面板等专项功能。
>
> 完全遵循原项目 **AGPL-3.0** 协议，感谢原作者 [@WJZ_P](https://github.com/WJZ-P) 的开源工作。

## ✨ 功能特性

### 🆕 海克斯大乱斗专项

| 功能 | 说明 |
|------|------|
| 🎁 **战利品助手** | 一键开宝箱（自动合钥匙）、分解碎片、蓝精激活英雄，支持保留余额 |
| ⭐ **大乱斗智能配装** | 模式分流，互不干涉：普通 ARAM 自动应用 OPGG 推荐符文（不动你的召唤师技能偏好）；海斗 KIWI 自动按英雄换最优召唤师技能（海斗游戏内无符文系统，跳过符文应用） |
| 🔱 **海克斯 augment 速查** | 选人后按"前/中/后期"分桶推送 augment 排行 + 核心装备到聊天框 + 桌面通知 |
| 📊 **海克斯常驻面板** | 海斗 BP 阶段在屏幕右侧浮窗显示当前英雄的 augment 推荐 + 核心装备组合，锁定/换英雄实时刷新 |
| 🔍 **海克斯速查面板** | 双 Tab：按英雄查 augment / 按 augment 反查最强英雄（数据：aramgg.com） |

### 继承自 Sona 的核心功能

- **对局增强**：自动接受、秒抢英雄、大乱斗无 CD 换英雄、队友战力分析、头像粒子特效（按胜率 5 档）、对局结束自动返回房间、平衡 buff 提示、自动点赞
- **战绩查询**：召唤师名#Tag 一次拉取近 100 场，支持模式过滤、详细战报、Game ID 复制
- **社交**：自定义签名 / 生涯背景（全皮肤）、开黑好友颜色标记、段位伪装、卸下头像框
- **工具**：回放下载观看、设置备份恢复（按 PUUID 隔离）、毛玻璃/亚克力窗口、全局粒子美化、开发者调试面板
- **界面**：Play 按钮旁快捷入口、F1~F5 呼出面板、增强在线状态、DOM 自愈

## 📦 安装

**前置条件**：[Pengu Loader](https://pengu.lol/) v1.1.0+

1. 安装 Pengu Loader（下载 release 中的 setup.exe 直接安装即可）
2. 打开 Pengu Loader → 右上角 **Plugins** → 右下角打开插件目录
3. 从本仓库 [Releases](https://github.com/Coordi777/sona-mayhem/releases) 下载压缩包（**不要下源码**），解压出 `sona-mayhem` 文件夹拖入插件目录
4. 回到 Loader 点刷新，重启客户端

> ⚠️ 从原 Sona 切换的玩家：本 fork 的插件目录名是 `sona-mayhem`（不是 `sona`），两者**可以共存**。配置按 PUUID 隔离，互不干扰。

## 🚀 使用

1. 启动英雄联盟客户端
2. 点击 Play 旁的 **Sona 头像图标**，或按 **F1** 打开面板
3. 在「工具」页开启/配置功能，所有设置自动持久化

> 💡 **海斗玩家推荐组合**：大乱斗智能配装 + 海克斯 augment 速查 + **海克斯常驻面板** + 大乱斗无 CD 换英雄 + 自动接受对局 + 对局结束自动返回房间，一套全自动闭环。

## 🏗️ 技术栈

TypeScript + React + Vite，运行在 Pengu Loader 之上，通过 LCU API（REST + WebSocket）与客户端交互。所有功能仅通过官方 API 实现，**不修改游戏文件，不注入游戏进程**。

核心模块：
- `LCUManager` — REST + WebSocket 双通道单例
- `InjectorManager` — MutationObserver 自愈，DOM 被刷掉自动补回
- `SonaStore` — 持久化配置 + 变化监听
- 数据源：[ARAMGG](https://aramgg.com/zh-CN)（海斗 augment / 核心装备 / 海斗英雄 T 级）、[OP.GG](https://op.gg/)（普通模式英雄 T 级 / 符文 / 召唤师技能）、[LoL Wiki](https://leagueoflegends.fandom.com/wiki/Module:ChampionData/data)（平衡数值）

## ⚠️ 注意事项

- 本插件运行在客户端内置浏览器中，无需配置端口或 Token
- 段位伪装仅影响好友列表名片，不影响实际排位数据
- 设置备份存储在 localStorage，按 PUUID 隔离，清除浏览器数据会丢失备份
- 战绩查询单次最多 100 条（LCU API 限制）

## 💬 反馈

- **海斗专项功能**问题：[本仓库 Issues](https://github.com/Coordi777/sona-mayhem/issues)
- **原 Sona 已有功能**的通用问题：建议优先到 [上游 WJZ-P/sona Issues](https://github.com/WJZ-P/sona/issues) 反馈，所有 Sona 用户受益
- PR：海斗增强相关欢迎；通用功能 PR 请打到上游 Sona

## � License

[AGPL-3.0](LICENSE)（继承自原 Sona）

## 💝 致谢

- 🎯 [**WJZ-P / sona**](https://github.com/WJZ-P/sona) — 本 fork 的直接上游，所有非海斗专项功能均完全继承自此项目
- 🔱 [**ARAMGG**](https://aramgg.com/zh-CN) — 海克斯大乱斗 augment / 核心装备 / 海斗英雄 T 级数据源
- 📦 [**OP.GG**](https://op.gg/) — 普通模式英雄 T 级 + 大乱斗符文 + 召唤师技能推荐数据
- 🎮 [**LoL Wiki**](https://leagueoflegends.fandom.com/wiki/Module:ChampionData/data) — 平衡性调整数据

以及上游 Sona 致谢的祖师项目：[BetterTencentLCU](https://github.com/BakaFT/BetterTencentLCU) · [upl](https://github.com/imunproductive/upl) · [CustomHookLoader](https://github.com/BakaFT/CustomHookLoader) · [balance-buff-viewer](https://github.com/nomi-san/balance-buff-viewer) · [LeagueAkari](https://github.com/LeagueAkari/LeagueAkari)

---

<div align="center">

Forked & maintained by [**Coordi777**](https://github.com/Coordi777) · 原作者 [**WJZ_P**](https://github.com/WJZ-P) ❤

如果觉得好用，请给个 ⭐ 支持一下

</div>
