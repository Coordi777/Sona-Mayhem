/**
 * 海克斯大乱斗速查弹窗
 *
 * 双 Tab:
 *   - 按英雄查:选英雄 → 列出全 augment 推荐(按胜率) + 核心装备 Top3
 *   - 按 augment 查:选 augment → 列出 Top10 拿这个 augment 强的英雄
 *
 * 数据来源:https://aramgg.com
 *   - /zh-CN/champion-stats/{id}              单英雄推荐
 *   - /data/aram-mayhem-augments.zh_cn.json   augment 元数据
 *   - /data/augments-stats-raw.json           全 augment 全英雄历史(反向查)
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SonaButton } from '@/components/ui/SonaButton'
import { SonaInput } from '@/components/ui/SonaInput'
import { SonaSelect } from '@/components/ui/SonaSelect'
import {
  aramggApi,
  type AramggChampionRecommendation,
  type AramggMayhemAugments,
  type AramggAugmentStatsEntry,
} from '@/lib/aramgg-api'
import {
  getAllChampions,
  getAugmentInfo,
  getChampIcon,
  getChampionById,
  getItemIcon,
  getItemName,
} from '@/lib/assets'
import { logger } from '@/index'

export interface MayhemAugmentLookupModalProps {
  open: boolean
  onClose: () => void
  /** 可选:打开时默认选中的英雄 ID(用于"快速查当前英雄") */
  defaultChampionId?: number
}

type Tab = 'byChampion' | 'byAugment'

// ==================== 全量元数据缓存(整个会话只拉一次) ====================

let cachedAugmentMeta: AramggMayhemAugments | null = null
let cachedAugmentStats: AramggAugmentStatsEntry[] | null = null
let metaLoadingPromise: Promise<void> | null = null

async function ensureMetaLoaded() {
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
      logger.warn('[Mayhem Lookup] 元数据加载失败:', err)
      throw err
    } finally {
      metaLoadingPromise = null
    }
  })()
  return metaLoadingPromise
}

// ==================== 工具 ====================

const STAGE_BUCKETS = [
  { key: 'early', label: '前期 (P1-2)', min: 0, max: 1.7 },
  { key: 'mid', label: '中期 (P2-3)', min: 1.7, max: 2.7 },
  { key: 'late', label: '后期 (P3-4)', min: 2.7, max: 4 },
] as const

function rarityIcon(rarity: number): string {
  return rarity >= 3 ? '🔱' : rarity >= 2 ? '⭐' : '◽'
}

function classifyStage(averageIndex: number): typeof STAGE_BUCKETS[number]['key'] {
  for (const b of STAGE_BUCKETS) {
    if (averageIndex >= b.min && averageIndex < b.max) return b.key
  }
  return 'late'
}

function getAugmentDisplayName(id: string | number): string {
  const idNum = typeof id === 'number' ? id : parseInt(id, 10)
  return getAugmentInfo(idNum)?.name
    || cachedAugmentMeta?.[String(id)]?.displayName
    || `#${id}`
}

function getAugmentRarity(id: string | number): number {
  return cachedAugmentMeta?.[String(id)]?.rarity ?? 0
}

function getAugmentIconUrl(id: string | number): string {
  const idNum = typeof id === 'number' ? id : parseInt(id, 10)
  const lcuIcon = getAugmentInfo(idNum)?.iconPath
  if (lcuIcon) return lcuIcon
  const small = cachedAugmentMeta?.[String(id)]?.iconSmall
  if (small) return small.startsWith('http') ? small : `https://aramgg.com${small}`
  return ''
}

// ==================== 主组件 ====================

export function MayhemAugmentLookupModal({ open, onClose, defaultChampionId }: MayhemAugmentLookupModalProps) {
  const [tab, setTab] = useState<Tab>('byChampion')
  const [metaError, setMetaError] = useState('')
  const [metaReady, setMetaReady] = useState(false)

  useEffect(() => {
    if (!open) return
    setMetaError('')
    ensureMetaLoaded()
      .then(() => setMetaReady(true))
      .catch((err) => setMetaError(`元数据加载失败:${err instanceof Error ? err.message : String(err)}`))
  }, [open])

  return (
    <Modal open={open} onClose={onClose} width={780} height={640}>
      <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', color: '#e8e3d3' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>♫ 海克斯大乱斗速查</h2>
        <p className="sona-subtitle" style={{ margin: '4px 0 14px' }}>
          数据源:aramgg.com · 含全 augment 推荐、核心装备、反向查最强英雄
        </p>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <TabButton active={tab === 'byChampion'} onClick={() => setTab('byChampion')}>按英雄查</TabButton>
          <TabButton active={tab === 'byAugment'} onClick={() => setTab('byAugment')}>按 augment 反查</TabButton>
        </div>

        {metaError && <p style={{ color: '#ff8080' }}>{metaError}</p>}

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {tab === 'byChampion' && metaReady && (
            <ByChampionPanel defaultChampionId={defaultChampionId} />
          )}
          {tab === 'byAugment' && metaReady && (
            <ByAugmentPanel />
          )}
          {!metaReady && !metaError && <p style={{ opacity: 0.6 }}>加载 ARAMGG 数据中...</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <SonaButton variant="secondary" onClick={onClose}>关闭</SonaButton>
        </div>
      </div>
    </Modal>
  )
}

// ==================== Tab 1:按英雄查 ====================

function ByChampionPanel({ defaultChampionId }: { defaultChampionId?: number }) {
  const champions = useMemo(() => getAllChampions().sort((a, b) => a.name.localeCompare(b.name, 'zh')), [])
  const [keyword, setKeyword] = useState('')
  const [championId, setChampionId] = useState<number>(defaultChampionId ?? 0)
  const [data, setData] = useState<AramggChampionRecommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const filteredChampions = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return champions.slice(0, 30)
    return champions.filter((c) =>
      c.name.toLowerCase().includes(k) ||
      c.alias.toLowerCase().includes(k) ||
      c.title.toLowerCase().includes(k),
    ).slice(0, 30)
  }, [keyword, champions])

  useEffect(() => {
    if (championId <= 0) {
      setData(null)
      return
    }
    setLoading(true)
    setError('')
    aramggApi.getChampionRecommendation(championId)
      .then((r) => setData(r))
      .catch((err) => setError(`查询失败:${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setLoading(false))
  }, [championId])

  return (
    <div>
      {/* 英雄选择 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <SonaInput
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索英雄(中文 / 英文 / 称号)"
          />
        </div>
        <span style={{ fontSize: 12, opacity: 0.6 }}>共 {filteredChampions.length} 个匹配</span>
      </div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 12,
        maxHeight: 100,
        overflow: 'auto',
        padding: '6px',
        background: 'rgba(0,0,0,0.15)',
        borderRadius: 6,
      }}>
        {filteredChampions.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChampionId(c.id)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: championId === c.id ? 'rgba(200,170,110,0.35)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${championId === c.id ? '#c8aa6e' : 'rgba(255,255,255,0.1)'}`,
              color: '#e8e3d3',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {c.name}
          </button>
        ))}
        {filteredChampions.length === 0 && <span style={{ opacity: 0.5, fontSize: 12 }}>未匹配</span>}
      </div>

      {/* 详情 */}
      {championId > 0 && (
        <div>
          <ChampionHeader championId={championId} data={data} loading={loading} />
          {error && <p style={{ color: '#ff8080' }}>{error}</p>}
          {data && (
            <>
              <ChampionAugmentsByStage data={data} />
              <ChampionCoreItems data={data} />
            </>
          )}
        </div>
      )}

      {championId === 0 && (
        <p style={{ opacity: 0.5, marginTop: 24, textAlign: 'center' }}>👆 选一个英雄查看 augment & 装备推荐</p>
      )}
    </div>
  )
}

function ChampionHeader({
  championId, data, loading,
}: { championId: number; data: AramggChampionRecommendation | null; loading: boolean }) {
  const champ = getChampionById(championId)
  const stats = data?.championStats
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(200,170,110,0.2)',
      borderRadius: 6,
      marginBottom: 12,
    }}>
      {champ && (
        <img src={getChampIcon(championId)} alt={champ.name} style={{ width: 44, height: 44, borderRadius: 4 }} />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{champ?.name ?? `#${championId}`}</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>{champ?.title ?? ''}</div>
      </div>
      {loading && <span style={{ opacity: 0.6, fontSize: 12 }}>加载中...</span>}
      {stats && (
        <div style={{ textAlign: 'right', fontSize: 12 }}>
          <div>胜率 <span style={{ color: '#f5d68b' }}>{parseFloat(stats.win_rate ?? '0').toFixed(1)}%</span></div>
          <div>出场 <span style={{ color: '#f5d68b' }}>{parseFloat(stats.pick_rate ?? '0').toFixed(1)}%</span> · 样本 {parseInt(stats.num_games ?? '0').toLocaleString()}</div>
        </div>
      )}
    </div>
  )
}

function ChampionAugmentsByStage({ data }: { data: AramggChampionRecommendation }) {
  const groups = useMemo(() => {
    const buckets: Record<string, Array<{ id: string; name: string; rarity: number; winRate: number; pickRate: number; games: number; averageIndex: number }>> = {
      early: [], mid: [], late: [],
    }
    for (const [id, stat] of Object.entries(data.augments)) {
      const games = parseInt(stat.num_games, 10) || 0
      if (games < 30) continue
      const averageIndex = parseFloat(stat.average_index ?? '2') || 2
      buckets[classifyStage(averageIndex)].push({
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

  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>🎁 Augment 推荐(按选号阶段)</h3>
      {STAGE_BUCKETS.map((b) => {
        const items = groups[b.key]
        if (items.length === 0) return null
        return (
          <div key={b.key} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>📍 {b.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {items.slice(0, 6).map((it) => (
                <AugmentRow key={it.id} {...it} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AugmentRow({ id, name, rarity, winRate, pickRate, games, averageIndex }: { id: string; name: string; rarity: number; winRate: number; pickRate: number; games: number; averageIndex: number }) {
  const icon = getAugmentIconUrl(id)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(200,170,110,0.12)',
      borderRadius: 4,
      fontSize: 12,
    }}>
      {icon && <img src={icon} alt={name} style={{ width: 28, height: 28, borderRadius: 3 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{rarityIcon(rarity)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
        <div style={{ opacity: 0.6, fontSize: 11 }}>
          胜率 <span style={{ color: '#f5d68b' }}>{winRate.toFixed(1)}%</span> · 出场 {pickRate.toFixed(1)}% · 平均第 {averageIndex.toFixed(1)} 选号 · {games} 局
        </div>
      </div>
    </div>
  )
}

function ChampionCoreItems({ data }: { data: AramggChampionRecommendation }) {
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
      .slice(0, 5)
  }, [data])

  if (builds.length === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>📦 核心装备组合 Top {builds.length}</h3>
      {builds.map((b, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(200,170,110,0.12)',
          borderRadius: 4,
          fontSize: 12,
          marginBottom: 4,
        }}>
          <span style={{ width: 18, fontWeight: 600, color: '#f5d68b' }}>{i + 1}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {b.ids.map((id, idx) => (
              <div key={`${i}-${id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {getItemIcon(id) && (
                  <img src={getItemIcon(id)} alt={getItemName(id)} title={getItemName(id)} style={{ width: 24, height: 24, borderRadius: 2 }} />
                )}
                {idx < b.ids.length - 1 && <span style={{ opacity: 0.5 }}>→</span>}
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 11 }}>
            胜率 <span style={{ color: '#f5d68b' }}>{b.winRate.toFixed(1)}%</span> · 出场 {b.pickRate.toFixed(1)}% · {b.games} 局
          </div>
        </div>
      ))}
    </div>
  )
}

// ==================== Tab 2:按 augment 反查 ====================

function ByAugmentPanel() {
  const [augmentId, setAugmentId] = useState<string>('')

  // 全 augment 列表(下拉)
  const augmentOptions = useMemo(() => {
    if (!cachedAugmentStats) return []
    return cachedAugmentStats
      .filter((entry) => parseInt(entry.stats.num_games, 10) >= 200)
      .map((entry) => ({
        id: String(entry.augmentId),
        name: getAugmentDisplayName(entry.augmentId),
        rarity: getAugmentRarity(entry.augmentId),
        winRate: parseFloat(entry.stats.win_rate) || 0,
        games: parseInt(entry.stats.num_games, 10) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [])

  const selectOptions = useMemo(() => augmentOptions.map((a) => ({
    value: a.id,
    label: `${rarityIcon(a.rarity)} ${a.name}`,
  })), [augmentOptions])

  const selected = augmentOptions.find((a) => a.id === augmentId)
  const stats = useMemo(() => {
    if (!augmentId || !cachedAugmentStats) return null
    return cachedAugmentStats.find((e) => String(e.augmentId) === augmentId) ?? null
  }, [augmentId])

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <SonaSelect
          options={selectOptions}
          value={augmentId}
          onChange={setAugmentId}
          placeholder={`选择 augment(共 ${augmentOptions.length} 个有数据)`}
        />
      </div>

      {!augmentId && (
        <p style={{ opacity: 0.5, marginTop: 24, textAlign: 'center' }}>👆 选一个 augment 看哪些英雄拿它最强</p>
      )}

      {selected && stats && (
        <>
          {/* 概览 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(200,170,110,0.2)',
            borderRadius: 6,
            marginBottom: 12,
          }}>
            {getAugmentIconUrl(selected.id) && (
              <img src={getAugmentIconUrl(selected.id)} alt={selected.name} style={{ width: 44, height: 44, borderRadius: 4 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {rarityIcon(selected.rarity)} {selected.name}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                综合胜率 <span style={{ color: '#f5d68b' }}>{selected.winRate.toFixed(1)}%</span> · 样本 {selected.games.toLocaleString()} 局
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, opacity: 0.6 }}>
              <div>版本 {stats.patchVersion}</div>
              <div>更新 {stats.updatedDate}</div>
            </div>
          </div>

          {/* 阶段分布 */}
          {stats.stats.augment_stage_stats && stats.stats.augment_stage_stats.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>📊 各选号阶段全局表现</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {stats.stats.augment_stage_stats.map((s, i) => (
                  <div key={i} style={{
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(200,170,110,0.12)',
                    borderRadius: 4,
                    fontSize: 11,
                  }}>
                    <div style={{ opacity: 0.6 }}>选号 {s.augment_stage}</div>
                    <div style={{ fontSize: 14, color: '#f5d68b', fontWeight: 600 }}>
                      {parseFloat(s.win_rate).toFixed(1)}%
                    </div>
                    <div style={{ opacity: 0.6 }}>
                      出场 {parseFloat(s.pick_rate).toFixed(1)}% · {parseInt(s.num_games, 10).toLocaleString()} 局
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top 英雄 */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>🏆 拿这个 Augment 最强的英雄 Top 10</h3>
            {(() => {
              const top = (stats.stats.top_champions ?? [])
                .slice()
                .sort((a, b) => parseFloat(b.win_rate) - parseFloat(a.win_rate))
                .slice(0, 10)
              if (top.length === 0) {
                return <p style={{ opacity: 0.5, fontSize: 12 }}>无 Top 英雄数据</p>
              }
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {top.map((c, i) => {
                    const id = parseInt(c.champion_id, 10)
                    const champ = getChampionById(id)
                    return (
                      <div key={`${id}-${i}`} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(200,170,110,0.12)',
                        borderRadius: 4,
                        fontSize: 12,
                      }}>
                        <span style={{ width: 16, fontWeight: 600, color: '#f5d68b' }}>{i + 1}</span>
                        {getChampIcon(id) && (
                          <img src={getChampIcon(id)} alt={champ?.name ?? `#${id}`} style={{ width: 28, height: 28, borderRadius: 14 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {champ?.name ?? `#${id}`}
                          </div>
                          <div style={{ opacity: 0.6, fontSize: 11 }}>
                            胜率 <span style={{ color: '#f5d68b' }}>{parseFloat(c.win_rate).toFixed(1)}%</span> · 出场 {parseFloat(c.pick_rate).toFixed(1)}% · {parseInt(c.num_games, 10)} 局
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}

// ==================== 通用小组件 ====================

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 16px',
        background: active ? 'rgba(200,170,110,0.25)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? '#c8aa6e' : 'rgba(255,255,255,0.1)'}`,
        color: active ? '#f5d68b' : '#cfc7b4',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}
