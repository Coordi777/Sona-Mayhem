/**
 * 今日战绩统计
 *
 * 拉自己最近一批对局，按"今日 0:00 (本地时区)"为分界线过滤，
 * 聚合出今日总胜率 + 各模式分桶。
 *
 * 数据源：LCU `/lol-match-history/v1/products/lol/{puuid}/matches`
 *
 * 缓存：模块级单例缓存（默认 5 分钟）。每次 LCU 重连或对局结束后可主动 invalidate。
 */

import { logger } from '@/index'
import { lcu } from '@/lib/lcu'
import type { MatchGame } from '@/types/lcu'
import { getQueueName } from '@/lib/assets'

/** 拉多少场用于今日筛选 — 一般玩家一天打不完 100 场，足够 */
const FETCH_COUNT = 100

/** 缓存 TTL（毫秒）— 5 分钟，避免频繁请求 LCU */
const CACHE_TTL_MS = 5 * 60 * 1000

export interface ModeStats {
  /** queueId, 0 表示自定义/未知 */
  queueId: number
  /** 显示名，如 "海克斯大乱斗" / "极地大乱斗" / "单/双排位" */
  name: string
  total: number
  wins: number
  /** 0-100 之间，0 表示 0 场 */
  winRate: number
}

export interface TodayStats {
  /** 今日所有模式聚合 */
  total: number
  wins: number
  losses: number
  /** 0-100 之间 */
  winRate: number
  /** 按模式分桶（按 total 降序） */
  byMode: ModeStats[]
  /** 数据生成时间戳，用于"X 分钟前更新" */
  computedAt: number
}

const EMPTY_STATS: TodayStats = {
  total: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  byMode: [],
  computedAt: 0,
}

// ==================== 缓存 ====================

let cachedStats: TodayStats | null = null
let cacheLoadedAt = 0
let inflightPromise: Promise<TodayStats> | null = null

/** 获取今日 0:00 本地时间戳 */
function getTodayStartMs(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  return start.getTime()
}

/** 在 game 中找到自己的 win 字段（boolean），找不到返回 null */
function findSelfWin(game: MatchGame, selfPuuid: string): boolean | null {
  // 1. participantIdentities 通过 puuid 匹配 (最可靠)
  const identity = game.participantIdentities?.find((p) => p.player?.puuid === selfPuuid)
  if (identity) {
    const participant = game.participants?.find((p) => p.participantId === identity.participantId)
    if (participant?.stats) return participant.stats.win
  }
  // 2. personal match-history endpoint 通常 participants 只含本人
  if (game.participants?.length === 1) {
    return game.participants[0].stats?.win ?? null
  }
  return null
}

/**
 * 拉自己最近 100 场对局，计算今日胜率。
 *
 * @param force 强制刷新缓存
 */
export async function computeTodayStats(force = false): Promise<TodayStats> {
  // 命中缓存
  if (!force && cachedStats && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedStats
  }
  // 并发去重
  if (inflightPromise) return inflightPromise

  inflightPromise = (async () => {
    try {
      const summoner = await lcu.getSummonerInfo()
      const puuid = summoner.puuid
      if (!puuid) {
        logger.warn('[TodayStats] 无 puuid，返回空统计')
        return EMPTY_STATS
      }

      const history = await lcu.getMatchHistory(puuid, 0, FETCH_COUNT - 1)
      const games = history.games?.games ?? []

      const todayStart = getTodayStartMs()
      const todayGames = games.filter((g) => {
        // gameCreation 是毫秒时间戳
        return g.gameCreation && g.gameCreation >= todayStart && g.endOfGameResult !== 'Abort_AntiCheatExit'
      })

      // 按 queueId 分桶
      const byQueue = new Map<number, { total: number; wins: number }>()
      let totalWins = 0
      let totalCount = 0

      for (const game of todayGames) {
        const win = findSelfWin(game, puuid)
        if (win === null) continue // 数据残缺，跳过
        totalCount++
        if (win) totalWins++

        const qid = game.queueId ?? 0
        const entry = byQueue.get(qid) ?? { total: 0, wins: 0 }
        entry.total++
        if (win) entry.wins++
        byQueue.set(qid, entry)
      }

      const byMode: ModeStats[] = Array.from(byQueue.entries())
        .map(([queueId, { total, wins }]) => ({
          queueId,
          name: queueId > 0 ? (getQueueName(queueId) || `队列 ${queueId}`) : '自定义',
          total,
          wins,
          winRate: total > 0 ? (wins / total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total)

      const stats: TodayStats = {
        total: totalCount,
        wins: totalWins,
        losses: totalCount - totalWins,
        winRate: totalCount > 0 ? (totalWins / totalCount) * 100 : 0,
        byMode,
        computedAt: Date.now(),
      }

      cachedStats = stats
      cacheLoadedAt = Date.now()

      logger.info(
        '[TodayStats] 今日 %d 局, %d 胜 (%d%% 胜率), 涉及 %d 种模式',
        stats.total,
        stats.wins,
        Math.round(stats.winRate),
        stats.byMode.length,
      )

      return stats
    } catch (err) {
      logger.warn('[TodayStats] 计算失败:', err)
      // 失败不缓存空结果，下次会重试
      return EMPTY_STATS
    } finally {
      inflightPromise = null
    }
  })()

  return inflightPromise
}

/** 主动失效缓存（如对局结束后调用） */
export function invalidateTodayStatsCache() {
  cachedStats = null
  cacheLoadedAt = 0
}

/** 同步读取最近一次的缓存（不触发请求）— 用于 SSR/初始渲染 */
export function getCachedTodayStats(): TodayStats | null {
  return cachedStats
}
