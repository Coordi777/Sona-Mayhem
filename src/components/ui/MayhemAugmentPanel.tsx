/**
 * 海克斯大乱斗 augment 推荐 — 可复用展示组件
 *
 * 入参：championId
 * 输出：英雄信息 header + 三阶段 augment Top + 核心装备组合 Top
 *
 * 用于：
 *   1. 速查弹窗 (MayhemAugmentLookupModal "按英雄查" Tab)
 *   2. 选人界面右侧常驻面板 (champselect-mayhem-panel)
 *
 * 自包含：内部完成 ARAMGG 数据请求 + 加载/错误三态管理。
 * 调用方只需保证已 ensureMayhemMetaLoaded()。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  aramggApi,
  type AramggChampionRecommendation,
} from '@/lib/aramgg-api'
import { getChampIcon, getChampionById, getItemIcon, getItemName } from '@/lib/assets'
import {
  STAGE_BUCKETS,
  classifyAugmentStage,
  getAugmentDisplayName,
  getAugmentIconUrl,
  getAugmentRarity,
  rarityIcon,
} from '@/lib/aramgg-meta'

export interface MayhemAugmentPanelProps {
  /** 当前要查询的英雄 ID（0 / 负值 / NaN 时显示提示） */
  championId: number
  /**
   * 紧凑模式（用于选人界面右侧浮窗）：
   *   - 字号略小，每阶段只展示 Top4 而不是 Top6
   *   - 隐藏每行的「平均第 X 选号 + 局数」明细，只保留胜率
   *   - 核心装备只展示 Top3
   */
  compact?: boolean
  /** 顶部标题（默认 "海克斯推荐"） */
  title?: string
}

export function MayhemAugmentPanel({ championId, compact = false, title = '海克斯推荐' }: MayhemAugmentPanelProps) {
  const [data, setData] = useState<AramggChampionRecommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!championId || championId <= 0) {
      setData(null)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    aramggApi.getChampionRecommendation(championId)
      .then((r) => { if (!cancelled) setData(r) })
      .catch((err) => { if (!cancelled) setError(`查询失败:${err instanceof Error ? err.message : String(err)}`) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [championId])

  if (!championId || championId <= 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
        ⏳ 等待英雄锁定...
      </div>
    )
  }

  return (
    <div>
      <PanelHeader championId={championId} data={data} loading={loading} title={title} />
      {error && (
        <p style={{ color: '#ff8080', fontSize: 12, marginTop: 8 }}>{error}</p>
      )}
      {data && (
        <>
          <AugmentsByStage data={data} compact={compact} />
          <CoreItems data={data} compact={compact} />
        </>
      )}
    </div>
  )
}

// ==================== 子组件 ====================

function PanelHeader({
  championId, data, loading, title,
}: { championId: number; data: AramggChampionRecommendation | null; loading: boolean; title: string }) {
  const champ = getChampionById(championId)
  const stats = data?.championStats
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(200,170,110,0.2)',
      borderRadius: 6,
      marginBottom: 10,
    }}>
      {champ && (
        <img src={getChampIcon(championId)} alt={champ.name} style={{ width: 36, height: 36, borderRadius: 4 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#c8aa6e' }}>♫</span>
          <span>{title}</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {champ?.name ?? `#${championId}`}
          {stats && (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              胜率 <span style={{ color: '#f5d68b' }}>{parseFloat(stats.win_rate ?? '0').toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>
      {loading && <span style={{ opacity: 0.6, fontSize: 11 }}>加载中…</span>}
    </div>
  )
}

interface AugmentRowData {
  id: string
  name: string
  rarity: number
  winRate: number
  pickRate: number
  games: number
  averageIndex: number
}

function AugmentsByStage({ data, compact }: { data: AramggChampionRecommendation; compact: boolean }) {
  const groups = useMemo(() => {
    const buckets: Record<string, AugmentRowData[]> = { early: [], mid: [], late: [] }
    for (const [id, stat] of Object.entries(data.augments)) {
      const games = parseInt(stat.num_games, 10) || 0
      if (games < 30) continue
      const averageIndex = parseFloat(stat.average_index ?? '2') || 2
      buckets[classifyAugmentStage(averageIndex)].push({
        id,
        name: getAugmentDisplayName(id),
        rarity: getAugmentRarity(id),
        winRate: parseFloat(stat.win_rate) || 0,
        pickRate: parseFloat(stat.pick_rate) || 0,
        games,
        averageIndex,
      })
    }
    for (const k of ['early', 'mid', 'late']) buckets[k].sort((a, b) => b.winRate - a.winRate)
    return buckets
  }, [data])

  const perStage = compact ? 4 : 6

  return (
    <div style={{ marginBottom: 10 }}>
      <h3 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px', opacity: 0.85 }}>🎁 Augment（按阶段）</h3>
      {STAGE_BUCKETS.map((b) => {
        const items = groups[b.key]
        if (items.length === 0) return null
        return (
          <div key={b.key} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>📍 {b.label}</div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)',
              gap: 4,
            }}>
              {items.slice(0, perStage).map((it) => (
                <AugmentRow key={it.id} {...it} compact={compact} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AugmentRow({ id, name, rarity, winRate, pickRate, games, averageIndex, compact }: AugmentRowData & { compact: boolean }) {
  const icon = getAugmentIconUrl(id)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 6px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(200,170,110,0.12)',
      borderRadius: 4,
      fontSize: 11,
    }}>
      {icon && <img src={icon} alt={name} style={{ width: 22, height: 22, borderRadius: 3 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ flexShrink: 0 }}>{rarityIcon(rarity)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
        {compact ? (
          <div style={{ opacity: 0.6, fontSize: 10 }}>
            胜率 <span style={{ color: '#f5d68b' }}>{winRate.toFixed(1)}%</span> · 出场 {pickRate.toFixed(1)}%
          </div>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 10 }}>
            胜率 <span style={{ color: '#f5d68b' }}>{winRate.toFixed(1)}%</span> · 出场 {pickRate.toFixed(1)}% · 平均第 {averageIndex.toFixed(1)} 选号 · {games} 局
          </div>
        )}
      </div>
    </div>
  )
}

function CoreItems({ data, compact }: { data: AramggChampionRecommendation; compact: boolean }) {
  const builds = useMemo(() => {
    return [...(data.coreItemBuilds ?? [])]
      .map((b) => ({
        ids: b.itemIds.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0),
        winRate: parseFloat(b.win_rate) || 0,
        pickRate: parseFloat(b.pick_rate) || 0,
        games: parseInt(b.games, 10) || 0,
      }))
      .filter((b) => b.ids.length > 0 && b.games >= 30)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, compact ? 3 : 5)
  }, [data, compact])

  if (builds.length === 0) return null

  return (
    <div>
      <h3 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px', opacity: 0.85 }}>📦 核心装备</h3>
      {builds.map((b, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(200,170,110,0.12)',
          borderRadius: 4,
          fontSize: 11,
          marginBottom: 3,
        }}>
          <span style={{ width: 14, fontWeight: 600, color: '#f5d68b' }}>{i + 1}</span>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {b.ids.map((id, idx) => (
              <span key={`${i}-${id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {getItemIcon(id) && (
                  <img src={getItemIcon(id)} alt={getItemName(id)} title={getItemName(id)} style={{ width: 20, height: 20, borderRadius: 2 }} />
                )}
                {idx < b.ids.length - 1 && <span style={{ opacity: 0.5 }}>→</span>}
              </span>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 10 }}>
            <span style={{ color: '#f5d68b' }}>{b.winRate.toFixed(1)}%</span>
            {!compact && <> · {b.games} 局</>}
          </div>
        </div>
      ))}
    </div>
  )
}
