/**
 * 大乱斗智能配装 + 海克斯 augment 速查
 *
 * 适用模式：
 *   - ARAM    queueId=450, gameMode='ARAM'    极地大乱斗
 *   - KIWI    queueId=3100, gameMode='KIWI'   海克斯大乱斗（mayhem）
 *
 * 触发时机：进入 ChampSelect 且本人英雄锁定后，每局只跑一次。
 *
 * 三件事（按用户开关分别启用）：
 *   1. aramSmartLoadout:
 *      - 符文 (ARAM + KIWI):     OPGG ARAM 数据胜率最高的 rune_pages
 *      - 召唤师技能 (仅 KIWI):  OPGG ARAM `summoner_spells` 按英雄取最佳组合
 *                                普通 ARAM 不动玩家选好的 spell（可能有 Heal/Cleanse/Mark 等偏好）
 *   2. mayhemAugmentTip: KIWI 模式下，把 ARAMGG augment Top5 推到聊天框 + 桌面通知
 *
 * 与现有 `smartBuildRecommendation` 共存策略：
 *   如果玩家已经在该英雄上保存过 smartRunePages 偏好（即用过 OPGG 面板的"应用"按钮），
 *   则跳过本模块的自动符文写入，让位给 OPGG 智能配装的"用户偏好恢复"逻辑。
 */

import { logger } from '@/index'
import { lcu, LcuEventUri } from '@/lib/lcu'
import type {
  ChampSelectSession,
  GameflowPhase,
  LCUEventMessage,
} from '@/lib/lcu'
import { store } from '@/lib/store'
import { opggApi } from '@/lib/opgg-api'
import type {
  OpggItemBuild,
  OpggNormalChampionData,
  OpggNormalModeChampion,
  OpggRuneBuild,
} from '@/lib/opgg-api'
import { aramggApi } from '@/lib/aramgg-api'
import type {
  AramggChampionRecommendation,
  AramggCoreItemBuild,
  AramggMayhemAugments,
} from '@/lib/aramgg-api'
import { getAugmentInfo, getChampionById, getItemName } from '@/lib/assets'

// ==================== 常量 ====================

/** 国服闪现的 spell ID */
const SUMMONER_SPELL_FLASH = 4
/** 国服 ARAM 雪球(寒冰碎片)的 spell ID */
const SUMMONER_SPELL_SNOWBALL = 32

const QUEUE_ARAM = 450
const QUEUE_KIWI = 3100

const ARAM_TIER = 'platinum_plus'

// ==================== 状态 ====================

let phaseUnsub: (() => void) | null = null
let sessionUnsub: (() => void) | null = null

/** 本局已经触发过哪些动作，防止重复执行 */
type TriggerFlags = {
  /** 已对哪个英雄 ID 触发过 loadout 应用 */
  loadoutAppliedFor: number
  /** 已对哪个英雄 ID 推送过 augment tip */
  augmentTipPushedFor: number
}

let flags: TriggerFlags = {
  loadoutAppliedFor: 0,
  augmentTipPushedFor: 0,
}

function resetFlags() {
  flags = { loadoutAppliedFor: 0, augmentTipPushedFor: 0 }
}

// ==================== 工具 ====================

function isAramOrKiwi(queueId: number): boolean {
  return queueId === QUEUE_ARAM || queueId === QUEUE_KIWI
}

function isKiwi(queueId: number): boolean {
  return queueId === QUEUE_KIWI
}

/**
 * 当前本人是否已锁定英雄
 *
 * 大乱斗没有 BP，session.actions 里只有 ten_bans_reveal、pick 等，
 * 我们以 myTeam 中本人的 championId > 0 视为已"锁定"（实际是分配，
 * 大乱斗一进选人就有英雄）。
 */
function getLocalLockedChampion(session: ChampSelectSession): {
  championId: number
  spell1Id: number
  spell2Id: number
} | null {
  const local = session.myTeam?.find((p) => p.cellId === session.localPlayerCellId)
  if (!local || !local.championId || local.championId <= 0) return null
  return {
    championId: local.championId,
    spell1Id: local.spell1Id ?? 0,
    spell2Id: local.spell2Id ?? 0,
  }
}

/**
 * 海克斯大乱斗 augment 阶段类型
 *
 * 海克斯大乱斗一局 4 个选号位,前期 augment 给基础属性、后期 augment 是终结技。
 * ARAMGG 数据里没有"按选号位胜率",但有 `average_index` 字段(玩家平均第几号选这个),
 * 用它分桶足以判断"前期/中期/后期"取向。
 */
type AugmentStage = 'early' | 'mid' | 'late'

const STAGE_LABELS: Record<AugmentStage, string> = {
  early: '📍 前期 (选号 1-2)',
  mid: '📍 中期 (选号 2-3)',
  late: '📍 后期 (选号 3-4)',
}

/** 按 average_index 分桶 */
function classifyAugmentStage(averageIndex: number): AugmentStage {
  if (averageIndex < 1.7) return 'early'
  if (averageIndex < 2.7) return 'mid'
  return 'late'
}

interface AugmentPick {
  id: string
  name: string
  rarity: number
  winRate: number
  pickRate: number
  games: number
  averageIndex: number
  stage: AugmentStage
}

/** 把 augments 整形 + 按阶段分组,每组取胜率 Top N */
function bucketAugmentsByStage(
  augments: Record<string, { tier: string; win_rate: string; num_games: string; pick_rate: string; average_index?: string }>,
  augmentMeta: AramggMayhemAugments,
  topPerStage = 3,
  minGames = 50,
): Record<AugmentStage, AugmentPick[]> {
  const list: AugmentPick[] = []

  for (const [id, stat] of Object.entries(augments)) {
    const games = parseInt(stat.num_games, 10) || 0
    if (games < minGames) continue
    const averageIndex = parseFloat(stat.average_index ?? '2') || 2
    // augment 名优先用 LCU 客户端资源,fallback 用 ARAMGG 元数据
    const lcuInfo = getAugmentInfo(parseInt(id, 10))
    const name = lcuInfo?.name || augmentMeta[id]?.displayName || `#${id}`
    list.push({
      id,
      name,
      rarity: augmentMeta[id]?.rarity ?? 0,
      winRate: parseFloat(stat.win_rate) || 0,
      pickRate: parseFloat(stat.pick_rate) || 0,
      games,
      averageIndex,
      stage: classifyAugmentStage(averageIndex),
    })
  }

  // 按 stage 分桶,每桶按胜率降序取 Top N
  const buckets: Record<AugmentStage, AugmentPick[]> = {
    early: [],
    mid: [],
    late: [],
  }
  for (const pick of list) {
    buckets[pick.stage].push(pick)
  }
  for (const stage of ['early', 'mid', 'late'] as AugmentStage[]) {
    buckets[stage].sort((a, b) => b.winRate - a.winRate)
    buckets[stage] = buckets[stage].slice(0, topPerStage)
  }
  return buckets
}

function rarityIcon(rarity: number): string {
  return rarity >= 3 ? '🔱' : rarity >= 2 ? '⭐' : '◽'
}

/** 选最佳核心装备组合(胜率 + 出场量复合排序,避免冷门高胜率噪音) */
function pickBestCoreItemBuild(builds: AramggCoreItemBuild[], minGames = 100): AramggCoreItemBuild | null {
  const valid = builds
    .map((b) => ({ build: b, games: parseInt(b.games, 10) || 0, winRate: parseFloat(b.win_rate) || 0 }))
    .filter((b) => b.games >= minGames)
  if (valid.length === 0) {
    // 降低 minGames 阈值再试一次
    const fallback = builds
      .map((b) => ({ build: b, games: parseInt(b.games, 10) || 0, winRate: parseFloat(b.win_rate) || 0 }))
      .filter((b) => b.games >= 20)
    if (fallback.length === 0) return null
    fallback.sort((a, b) => b.winRate - a.winRate)
    return fallback[0].build
  }
  valid.sort((a, b) => b.winRate - a.winRate)
  return valid[0].build
}

/** 把 itemIds (`"3001,3157,3089"`) 转成中文名链 */
function formatItemBuildPath(itemIdsStr: string): string {
  const ids = itemIdsStr.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)
  if (ids.length === 0) return ''
  return ids.map((id) => getItemName(id) || `#${id}`).join(' → ')
}

// ==================== Action: 自动符文 + 召唤师技能 ====================

/**
 * 从 OPGG ARAM 的 summoner_spells 数据中挑出「胜率最高且样本充足」的组合。
 *
 * 数据形态：每个 OpggItemBuild 的 ids = [spell1Id, spell2Id]，play 是样本量，win 是胜利数。
 * 选择策略：要求 ≥ MIN_GAMES 局，再按胜率降序；不够 MIN_GAMES 的话降到 ≥ FALLBACK_MIN_GAMES。
 *
 * @returns 推荐的 [spell1Id, spell2Id]；数据缺失时返回 null（调用方应 fallback 到默认）
 */
function pickBestSummonerSpells(builds: OpggItemBuild[] | undefined): [number, number] | null {
  if (!builds || builds.length === 0) return null
  const MIN_GAMES = 200
  const FALLBACK_MIN_GAMES = 50

  const valid = builds
    .filter((b) => Array.isArray(b.ids) && b.ids.length === 2 && b.play > 0
      && b.ids[0] > 0 && b.ids[1] > 0 && b.ids[0] !== b.ids[1])
    .map((b) => ({ ids: b.ids as [number, number], winRate: b.win / b.play, play: b.play }))

  if (valid.length === 0) return null

  let pool = valid.filter((b) => b.play >= MIN_GAMES)
  if (pool.length === 0) pool = valid.filter((b) => b.play >= FALLBACK_MIN_GAMES)
  if (pool.length === 0) pool = valid

  pool.sort((a, b) => b.winRate - a.winRate || b.play - a.play)
  return pool[0].ids
}

/**
 * 应用大乱斗符文 + 召唤师技能
 *
 * 召唤师技能：**仅在海斗 (KIWI / queueId 3100) 自动应用**。
 *   - 普通 ARAM 不动玩家选好的 spell（可能有 Heal/Cleanse/Mark 等偏好）
 *   - 海斗才走"按英雄从 OPGG ARAM `summoner_spells` 取胜率最高组合"的逻辑
 *   - 数据缺失时 fallback 到默认 Flash + Snowball
 *
 * 符文：ARAM 与 KIWI 都自动应用 OPGG ARAM 推荐符文。
 *
 * @param championId 已锁定的英雄
 * @param current 当前已选的 spell1/spell2
 * @param queueId 当前队列 (450 = ARAM, 3100 = KIWI)
 * @returns 实际应用了几项（用于聊天提示）
 */
async function applyAramLoadout(
  championId: number,
  current: { spell1Id: number; spell2Id: number },
  queueId: number,
): Promise<{ runesApplied: boolean; spellsApplied: boolean }> {
  let runesApplied = false
  let spellsApplied = false

  // ① 拉 OPGG ARAM 数据（一次拉取，符文 + 召唤师技能复用）
  let data: OpggNormalChampionData | undefined
  try {
    const version = await lcu.getGameVersion().catch(() => '')
    const opggVersion = version.match(/^(\d+\.\d+)/)?.[1]

    const champion = await opggApi.getChampion({
      id: championId,
      region: 'global',
      mode: 'aram',
      tier: ARAM_TIER,
      version: opggVersion,
      position: 'none',
    }) as OpggNormalModeChampion

    data = champion?.data
  } catch (err) {
    logger.warn('[ARAM Loadout] OPGG ARAM 数据拉取失败，召唤师技能将 fallback 到默认:', err)
  }

  const championName = getChampionById(championId)?.name ?? '英雄'

  // ② 召唤师技能：仅海斗 (KIWI) 自动应用，普通 ARAM 不动
  if (isKiwi(queueId)) {
    const recommended = pickBestSummonerSpells(data?.summoner_spells)
    const wantSpells: [number, number] = recommended ?? [SUMMONER_SPELL_FLASH, SUMMONER_SPELL_SNOWBALL]

    const wantSpellSet = new Set(wantSpells)
    const haveSpellSet = new Set([current.spell1Id, current.spell2Id])
    const allMatch = wantSpellSet.size === haveSpellSet.size
      && [...wantSpellSet].every((s) => haveSpellSet.has(s))

    if (!allMatch) {
      try {
        await lcu.updateMySelection({
          spell1Id: wantSpells[0],
          spell2Id: wantSpells[1],
        })
        spellsApplied = true
        logger.info(
          '[ARAM Loadout] 已自动设置召唤师技能 → %s spell1=%d spell2=%d (来源:%s)',
          championName, wantSpells[0], wantSpells[1], recommended ? 'OPGG' : 'fallback',
        )
      } catch (err) {
        logger.warn('[ARAM Loadout] 自动设置召唤师技能失败:', err)
      }
    }
  } else {
    logger.debug('[ARAM Loadout] 普通 ARAM (queueId=%d)，跳过召唤师技能自动设置', queueId)
  }

  // ③ 检查智能配装是否已记忆该英雄的偏好（共存策略）
  const runeKey = `${championId}_aram`
  const savedRunes = store.get('smartRunePages')[runeKey]
  if (
    savedRunes &&
    store.get('smartBuildRecommendation') &&
    savedRunes.selectedPerkIds.length >= 8
  ) {
    logger.info('[ARAM Loadout] 检测到智能配装记忆 (key=%s)，跳过自动符文写入', runeKey)
    return { runesApplied, spellsApplied }
  }

  // ④ 应用 OPGG ARAM 推荐符文（复用上面已拉的 data）
  if (!data) {
    return { runesApplied, spellsApplied }
  }

  try {
    const runePages = data.rune_pages ?? []
    // 选胜率最高的 rune_page 的 builds[0]
    const bestPage = [...runePages].sort((a, b) => {
      const wrA = a.play > 0 ? a.win / a.play : 0
      const wrB = b.play > 0 ? b.win / b.play : 0
      return wrB - wrA
    })[0]
    const bestBuild: OpggRuneBuild | undefined = bestPage?.builds?.[0]

    if (bestBuild) {
      await lcu.applyRunePage({
        name: `[Sona] ${championName} 大乱斗`,
        primaryStyleId: bestBuild.primary_page_id,
        subStyleId: bestBuild.secondary_page_id,
        selectedPerkIds: [
          ...bestBuild.primary_rune_ids,
          ...bestBuild.secondary_rune_ids,
          ...bestBuild.stat_mod_ids,
        ],
      })
      runesApplied = true
      logger.info(
        '[ARAM Loadout] 已自动应用符文 → %s primary=%d sub=%d',
        championName, bestBuild.primary_page_id, bestBuild.secondary_page_id,
      )
    } else {
      logger.warn('[ARAM Loadout] OPGG ARAM 数据无 rune_pages，跳过符文应用')
    }
  } catch (err) {
    logger.warn('[ARAM Loadout] 应用符文失败:', err)
  }

  return { runesApplied, spellsApplied }
}

// ==================== Action: 海克斯 augment 速查 ====================

/**
 * KIWI 模式下推送当前英雄推荐到聊天框 + 桌面通知
 *
 * 内容：
 *   1. augment 按"前期/中期/后期"三段拆分,每段 Top3
 *   2. 核心装备 Top1 出装路径
 */
async function pushMayhemAugmentTip(championId: number): Promise<void> {
  try {
    const [recommendation, augmentMeta] = await Promise.all([
      aramggApi.getChampionRecommendation(championId),
      aramggApi.getMayhemAugmentsZhCn().catch(() => ({} as AramggMayhemAugments)),
    ]) as [AramggChampionRecommendation, AramggMayhemAugments]

    if (!recommendation.augments || Object.keys(recommendation.augments).length === 0) {
      logger.info('[Mayhem Tip] ARAMGG 未返回 augment 数据,跳过')
      return
    }

    // ① 按阶段分桶
    const buckets = bucketAugmentsByStage(recommendation.augments, augmentMeta, 3)
    const stageOrder: AugmentStage[] = ['early', 'mid', 'late']
    const hasAnyAugment = stageOrder.some((stage) => buckets[stage].length > 0)
    if (!hasAnyAugment) {
      logger.info('[Mayhem Tip] augment 样本量不足,跳过')
      return
    }

    const championName = getChampionById(championId)?.name ?? '英雄'

    // ② 选最佳核心装备
    const bestCore = pickBestCoreItemBuild(recommendation.coreItemBuilds ?? [])

    // 拼聊天框文本
    const chatLines: string[] = [
      `Sona助手 ♫   ${championName} 海克斯大乱斗推荐:`,
    ]
    for (const stage of stageOrder) {
      const picks = buckets[stage]
      if (picks.length === 0) continue
      chatLines.push(STAGE_LABELS[stage])
      for (const p of picks) {
        chatLines.push(
          `  ${rarityIcon(p.rarity)} ${p.name} | 胜率 ${p.winRate.toFixed(1)}% | 出场 ${p.pickRate.toFixed(1)}%`,
        )
      }
    }
    if (bestCore) {
      const path = formatItemBuildPath(bestCore.itemIds)
      const wr = parseFloat(bestCore.win_rate).toFixed(1)
      const pr = parseFloat(bestCore.pick_rate).toFixed(1)
      chatLines.push(`📦 核心装备: ${path}`)
      chatLines.push(`     胜率 ${wr}% | 出场 ${pr}%`)
    }

    // 1) 选人聊天(仅自己可见)
    try {
      await lcu.sendChampSelectMessage(chatLines.join('\n'), 'celebration')
    } catch (err) {
      logger.info('[Mayhem Tip] 选人聊天发送失败(聊天室可能未就绪):', err)
    }

    // 2) 桌面通知:精简版,只列最佳前期 + 后期 augment + 核心装备
    try {
      const earlyTop = buckets.early[0]?.name ?? ''
      const lateTop = buckets.late[0]?.name || buckets.mid[0]?.name || ''
      const coreBrief = bestCore ? formatItemBuildPath(bestCore.itemIds) : ''
      const detailParts: string[] = []
      if (earlyTop) detailParts.push(`前期: ${earlyTop}`)
      if (lateTop && lateTop !== earlyTop) detailParts.push(`后期: ${lateTop}`)
      if (coreBrief) detailParts.push(`装备: ${coreBrief}`)
      await lcu.sendNotification(
        `${championName} 海克斯大乱斗推荐`,
        detailParts.join(' · ') || '详细见聊天框',
      )
    } catch (err) {
      logger.info('[Mayhem Tip] 客户端通知发送失败:', err)
    }

    // 日志摘要
    const summaryLine: string[] = []
    for (const stage of stageOrder) {
      const top = buckets[stage][0]
      if (top) summaryLine.push(`${stage}=${top.name}(${top.winRate.toFixed(1)}%)`)
    }
    logger.info('[Mayhem Tip] 已推送 %s → %s', championName, summaryLine.join(', '))
  } catch (err) {
    logger.warn('[Mayhem Tip] augment 推送失败:', err)
  }
}

// ==================== 主逻辑 ====================

async function handleSession(session: ChampSelectSession): Promise<void> {
  const queueId = session.queueId ?? 0
  if (!isAramOrKiwi(queueId)) return

  const local = getLocalLockedChampion(session)
  if (!local) return

  // ① 自动符文 + 技能
  if (
    store.get('aramSmartLoadout') &&
    flags.loadoutAppliedFor !== local.championId
  ) {
    flags.loadoutAppliedFor = local.championId
    applyAramLoadout(local.championId, {
      spell1Id: local.spell1Id,
      spell2Id: local.spell2Id,
    }, queueId).then((result) => {
      if (result.runesApplied || result.spellsApplied) {
        const championName = getChampionById(local.championId)?.name ?? '英雄'
        const restored = result.runesApplied && result.spellsApplied
          ? '符文 & 召唤师技能'
          : result.runesApplied ? '符文' : '召唤师技能'
        lcu.sendChampSelectMessage(
          `${championName} 大乱斗${restored}已应用 - Sona`,
          'celebration',
        ).catch(() => { /* 选人聊天不可达时静默 */ })
      }
    }).catch((err) => {
      logger.warn('[ARAM Loadout] 应用失败:', err)
    })
  }

  // ② Mayhem augment tip（仅 KIWI）
  if (
    isKiwi(queueId) &&
    store.get('mayhemAugmentTip') &&
    flags.augmentTipPushedFor !== local.championId
  ) {
    flags.augmentTipPushedFor = local.championId
    pushMayhemAugmentTip(local.championId).catch((err) => {
      logger.warn('[Mayhem Tip] 失败:', err)
    })
  }
}

function onChampSelectUpdate(event: LCUEventMessage): void {
  if (event.eventType === 'Delete') {
    resetFlags()
    return
  }
  const session = event.data as ChampSelectSession | null
  if (!session) return
  handleSession(session).catch((err) => {
    logger.warn('[ARAM Loadout] 处理 ChampSelect 更新失败:', err)
  })
}

function onPhaseChange(event: LCUEventMessage): void {
  const phase = event.data as GameflowPhase
  if (phase !== 'ChampSelect') {
    // 离开选人时重置标记，下一局重新触发
    resetFlags()
  }
}

// ==================== 生命周期 ====================

/**
 * 当任一相关开关变化时调用：根据"是否有任一开关启用"决定挂载/卸载监听
 */
export function updateAramSmartLoadout(): void {
  const enabled = store.get('aramSmartLoadout') || store.get('mayhemAugmentTip')

  if (enabled && !sessionUnsub) {
    resetFlags()
    sessionUnsub = lcu.observe(LcuEventUri.CHAMP_SELECT, onChampSelectUpdate)
    phaseUnsub = lcu.observe(LcuEventUri.GAMEFLOW_PHASE_CHANGE, onPhaseChange)

    // 进游戏时如果已经在 ChampSelect 阶段，主动跑一次
    lcu.getChampSelectSession()
      .then((session) => session && handleSession(session))
      .catch(() => { /* 不在选人阶段时正常 */ })

    logger.info('[ARAM Loadout] 大乱斗智能配装监听已启用 ✓')
  } else if (!enabled && sessionUnsub) {
    sessionUnsub()
    sessionUnsub = null
    phaseUnsub?.()
    phaseUnsub = null
    resetFlags()
    logger.info('[ARAM Loadout] 大乱斗智能配装监听已停用')
  }
}
