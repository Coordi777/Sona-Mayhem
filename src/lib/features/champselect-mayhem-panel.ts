/**
 * 海克斯大乱斗选人界面常驻面板
 *
 * 进入海克斯大乱斗（KIWI / queueId 3100）选人界面后，
 * 在屏幕右侧固定位置显示当前英雄的 augment 推荐 + 核心装备推荐。
 *
 * 触发条件：
 *   - gameflow phase = 'ChampSelect'
 *   - queueId = 3100（仅 KIWI / 海斗）
 *   - 本人英雄已锁定（championId > 0）
 *   - store.mayhemAugmentPanel = true
 *
 * 数据驱动：复用 <MayhemAugmentPanel> + ensureMayhemMetaLoaded()，
 * 与速查弹窗共享同一份 ARAMGG augment 元数据缓存。
 *
 * 实现技巧：
 *   - 用 createRoot + fixed positioning 容器，不依赖客户端具体 DOM 结构
 *   - 监听 champ-select session 实时更新 championId
 *   - 离开 ChampSelect 卸载，避免泄漏
 */

import { createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { logger } from '@/index'
import { lcu, LcuEventUri } from '@/lib/lcu'
import type { ChampSelectSession, GameflowPhase, LCUEventMessage } from '@/lib/lcu'
import { store } from '@/lib/store'
import { ensureMayhemMetaLoaded } from '@/lib/aramgg-meta'
import { MayhemAugmentPanel } from '@/components/ui/MayhemAugmentPanel'

// 海克斯大乱斗专属 queueId
const QUEUE_KIWI = 3100

const ROOT_ID = 'sona-mayhem-augment-panel-root'

let phaseUnsub: (() => void) | null = null
let sessionUnsub: (() => void) | null = null
let rootContainer: HTMLDivElement | null = null
let reactRoot: Root | null = null
let mounted = false
let lastChampionId = 0

// ==================== 容器创建 / 销毁 ====================

function createContainer(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = ROOT_ID
  Object.assign(el.style, {
    position: 'fixed',
    right: '14px',
    top: '88px',
    width: '300px',
    maxHeight: 'calc(100vh - 200px)',
    overflowY: 'auto',
    zIndex: '999',
    padding: '12px',
    background: 'rgba(15, 22, 32, 0.92)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(200, 170, 110, 0.35)',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    color: '#e8e3d3',
    fontFamily: '"Beaufort for LOL", "Microsoft YaHei", sans-serif',
    fontSize: '12px',
    lineHeight: '1.4',
    pointerEvents: 'auto',
  } as CSSStyleDeclaration)
  document.body.appendChild(el)
  return el
}

function renderInto(container: HTMLDivElement, championId: number) {
  if (!reactRoot) {
    reactRoot = createRoot(container)
  }
  const node: ReactElement = createElement(MayhemAugmentPanel, {
    championId,
    compact: true,
    title: '海克斯推荐',
  })
  reactRoot.render(node)
}

// ==================== 选人会话处理 ====================

/** 从 session 提取本人 championId（已锁定优先，hover 兜底） */
function extractLocalChampionId(session: ChampSelectSession | null): number {
  if (!session) return 0
  const local = session.myTeam?.find((p) => p.cellId === session.localPlayerCellId)
  if (!local) return 0
  if (local.championId > 0) return local.championId
  if (local.championPickIntent > 0) return local.championPickIntent
  return 0
}

function onSessionUpdate(session: ChampSelectSession | null) {
  // 仅 KIWI 模式下显示
  if (!session || session.queueId !== QUEUE_KIWI) {
    if (mounted) unmountPanel()
    return
  }

  const championId = extractLocalChampionId(session)
  if (championId === lastChampionId && mounted) return

  lastChampionId = championId

  if (!rootContainer) rootContainer = createContainer()
  renderInto(rootContainer, championId)
  mounted = true
}

// ==================== 阶段挂载 / 卸载 ====================

async function mountForChampSelect() {
  // 仅在玩家开启了开关时挂载
  if (!store.get('mayhemAugmentPanel')) return

  // 检查当前 queue 是否为 KIWI；不是则不挂
  const session = await lcu.getChampSelectSession().catch(() => null)
  if (!session || session.queueId !== QUEUE_KIWI) {
    logger.debug('[Mayhem Panel] 非海斗模式，跳过挂载 (queueId=%d)', session?.queueId ?? 0)
    return
  }

  logger.info('[Mayhem Panel] 进入海斗选人，开始挂载常驻面板')

  // 预先触发 ARAMGG 元数据加载（与速查弹窗共享缓存）
  ensureMayhemMetaLoaded().catch(() => { /* logged in ensureMayhemMetaLoaded */ })

  // 立即根据当前 session 渲染一次
  onSessionUpdate(session)

  // 订阅 session 变化（hover / 锁定 / 队友改英雄等）
  if (sessionUnsub) sessionUnsub()
  sessionUnsub = lcu.observe(LcuEventUri.CHAMP_SELECT, (event: LCUEventMessage) => {
    onSessionUpdate(event.data as ChampSelectSession | null)
  })
}

function unmountPanel() {
  if (sessionUnsub) {
    sessionUnsub()
    sessionUnsub = null
  }
  if (reactRoot) {
    reactRoot.unmount()
    reactRoot = null
  }
  if (rootContainer) {
    rootContainer.remove()
    rootContainer = null
  }
  mounted = false
  lastChampionId = 0
}

// ==================== 对外接口 ====================

/**
 * 启用/禁用「海斗选人界面常驻面板」
 * 监听 gameflow-phase：进入 ChampSelect 时 mount（仅 KIWI），离开时 unmount。
 */
export function updateMayhemAugmentPanel(enabled: boolean) {
  logger.debug('[Mayhem Panel] updateMayhemAugmentPanel: enabled=%s, phaseUnsub=%s', enabled, !!phaseUnsub)

  if (enabled && !phaseUnsub) {
    phaseUnsub = lcu.observe(LcuEventUri.GAMEFLOW_PHASE_CHANGE, (event: LCUEventMessage) => {
      const phase = event.data as GameflowPhase
      if (phase === 'ChampSelect') {
        unmountPanel()
        void mountForChampSelect()
      } else {
        unmountPanel()
      }
    })

    // 插件启动时若已经在 ChampSelect 阶段，立即挂载
    lcu.getGameflowPhase().then((phase) => {
      logger.debug('[Mayhem Panel] 启动时当前阶段=%s', phase)
      if (phase === 'ChampSelect') {
        unmountPanel()
        void mountForChampSelect()
      }
    }).catch(() => { /* ignore */ })

    logger.info('[Mayhem Panel] 海斗选人常驻面板已启用 ✓')
  } else if (!enabled && phaseUnsub) {
    phaseUnsub()
    phaseUnsub = null
    unmountPanel()
    logger.info('[Mayhem Panel] 海斗选人常驻面板已禁用')
  }
}
