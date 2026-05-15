import '@/styles/AboutPage.css'
import { InfoCard } from '@/components/ui/InfoCard'
import { ZapIcon, CodeIcon, BoxIcon, GitHubIcon } from '@/components/ui/icons'

declare const __PLUGIN_VERSION__: string

export function AboutPage() {
  return (
    <div className="sona-about">
      <div className="sona-about-header">
        <h2 className="sona-about-title">Sona-Mayhem</h2>
        <span className="sona-about-version">v{__PLUGIN_VERSION__}</span>
      </div>

      <p className="sona-about-desc">
        Sona-Mayhem 是 <a href="https://github.com/WJZ-P/sona" target="_blank" rel="noopener noreferrer" style={{ color: '#c8aa6e' }}>WJZ-P/sona</a> 的 fork,
        在保留原 Sona 全部功能的基础上,**针对海克斯大乱斗(海斗)玩家**新增战利品助手、大乱斗智能配装、海克斯 augment 速查面板等专项功能。
      </p>

      {/* 信息卡片 + 技术栈 并排 */}
      <div className="sona-about-row">
        <div className="sona-about-cards">
          <InfoCard icon={<ZapIcon />} label="插件" value={`Sona-Mayhem v${__PLUGIN_VERSION__}`} />
          <InfoCard icon={<CodeIcon />} label="框架" value="React + Vite" />
          <InfoCard
            icon={<BoxIcon />}
            label="加载器"
            value={`Pengu Loader ${typeof Pengu !== 'undefined' ? Pengu.version : '1.1.6'}`}
          />
        </div>

        <div className="sona-about-section sona-about-tech">
          <h3 className="sona-about-section-title">技术栈</h3>
          <ul className="sona-about-list">
            <li>React 19 + TypeScript</li>
            <li>Vite 6</li>
            <li>Pengu Loader v1.1.0+</li>
            <li>LCU REST API + WebSocket</li>
            <li>SGP / OPGG / ARAMGG 数据源</li>
          </ul>
          <a
            className="sona-hex-card sona-hex-card-link"
            href="https://github.com/Coordi777/sona-mayhem"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="sona-hex-card-icon"><GitHubIcon /></span>
            <div className="sona-hex-card-text">
              <span className="sona-hex-card-label">本 Fork</span>
              <span className="sona-hex-card-value">Coordi777/sona-mayhem</span>
            </div>
          </a>
          <a
            className="sona-hex-card sona-hex-card-link"
            href="https://github.com/WJZ-P/sona"
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginTop: 8 }}
          >
            <span className="sona-hex-card-icon"><GitHubIcon /></span>
            <div className="sona-hex-card-text">
              <span className="sona-hex-card-label">原作上游</span>
              <span className="sona-hex-card-value">WJZ-P/sona</span>
            </div>
          </a>
        </div>
      </div>

      <div className="sona-about-section">
        <h3 className="sona-about-section-title">海克斯大乱斗专项功能</h3>
        <ul className="sona-about-list">
          <li>🎁 战利品助手 — 一键开宝箱 / 合钥匙 / 分解碎片 / 蓝精激活英雄</li>
          <li>⭐ 大乱斗智能配装 — 自动应用 OPGG 推荐符文 + 闪现 / 雪球</li>
          <li>🔱 海克斯大乱斗 augment 速查 — 选人后按选号阶段推送 augment + 核心装备</li>
          <li>🔍 海克斯速查面板 — 按英雄 / 按 augment 双向反查</li>
        </ul>
      </div>

      <div className="sona-about-section">
        <h3 className="sona-about-section-title">开源协议</h3>
        <p className="sona-about-text">AGPL-3.0(继承自原 Sona)</p>
      </div>

      <div className="sona-about-quote">
        Forked & maintained by <strong>Coordi777</strong> · 衷心感谢原作者 <strong>WJZ_P</strong> ❤
      </div>
    </div>
  )
}
