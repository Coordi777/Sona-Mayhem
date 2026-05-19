/**
 * ARAMGG augment 元数据共享缓存与工具函数
 *
 * 由海克斯速查弹窗 (MayhemAugmentLookupModal) 与选人界面常驻面板
 * (MayhemAugmentPanel) 共用，避免重复请求和代码重复。
 *
 * 缓存粒度：会话级（cachedAugmentMeta + cachedAugmentStats），
 * 通过 ensureMetaLoaded() 保证并发去重。
 */

import { logger } from '@/index'
import {
  aramggApi,
  type AramggAugmentStatsEntry,
  type AramggMayhemAugments,
} from '@/lib/aramgg-api'
import { getAugmentInfo } from '@/lib/assets'

// ==================== 全量元数据缓存（整个会话只拉一次） ====================

let cachedAugmentMeta: AramggMayhemAugments | null = null
let cachedAugmentStats: AramggAugmentStatsEntry[] | null = null
let metaLoadingPromise: Promise<void> | null = null

export function getCachedAugmentMeta(): AramggMayhemAugments | null {
  return cachedAugmentMeta
}

export function getCachedAugmentStats(): AramggAugmentStatsEntry[] | null {
  return cachedAugmentStats
}

/**
 * 加载 ARAMGG augment 中文元数据 + 全量统计。
 * 已缓存则立即 resolve；并发调用复用同一 Promise，避免重复请求。
 */
export async function ensureMayhemMetaLoaded(): Promise<void> {
  if (cachedAugmentMeta && cachedAugmentStats) return
  if (metaLoadingPromise) return metaLoadingPromise
  metaLoadingPromise = (async () => {
    try {
      const [meta, stats] = await Promise.all([
        aramggApi.getMayhemAugmentsZhCn(),
        aramggApi.getAugmentsStats(),
      ])
      cachedAugmentMeta = meta
      cachedAugmentStats = stats
    } catch (err) {
      logger.warn('[Mayhem Meta] 元数据加载失败:', err)
      throw err
    } finally {
      metaLoadingPromise = null
    }
  })()
  return metaLoadingPromise
}

// ==================== 选号位分桶 ====================

export const STAGE_BUCKETS = [
  { key: 'early', label: '前期 (P1-2)', min: 0, max: 1.7 },
  { key: 'mid', label: '中期 (P2-3)', min: 1.7, max: 2.7 },
  { key: 'late', label: '后期 (P3-4)', min: 2.7, max: 4 },
] as const

export type StageKey = typeof STAGE_BUCKETS[number]['key']

export function classifyAugmentStage(averageIndex: number): StageKey {
  for (const b of STAGE_BUCKETS) {
    if (averageIndex >= b.min && averageIndex < b.max) return b.key
  }
  return 'late'
}

// ==================== augment 展示工具 ====================

export function rarityIcon(rarity: number): string {
  return rarity >= 3 ? '🔱' : rarity >= 2 ? '⭐' : '◽'
}

export function getAugmentDisplayName(id: string | number): string {
  const idNum = typeof id === 'number' ? id : parseInt(id, 10)
  return getAugmentInfo(idNum)?.name
    || cachedAugmentMeta?.[String(id)]?.displayName
    || `#${id}`
}

export function getAugmentRarity(id: string | number): number {
  return cachedAugmentMeta?.[String(id)]?.rarity ?? 0
}

export function getAugmentIconUrl(id: string | number): string {
  const idNum = typeof id === 'number' ? id : parseInt(id, 10)
  const lcuIcon = getAugmentInfo(idNum)?.iconPath
  if (lcuIcon) return lcuIcon
  const small = cachedAugmentMeta?.[String(id)]?.iconSmall
  if (small) return small.startsWith('http') ? small : `https://aramgg.com${small}`
  return ''
}
