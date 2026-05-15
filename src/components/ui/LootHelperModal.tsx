/**
 * 战利品助手弹窗
 *
 * 提供：一键开箱 / 合钥匙 / 分解碎片 / 激活英雄碎片
 * 数据来源：fetchLootSummary（基于 LCU /lol-loot/v1/*）
 */

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SonaButton } from '@/components/ui/SonaButton'
import { SonaInput } from '@/components/ui/SonaInput'
import {
  fetchLootSummary,
  openAllChests,
  forgeAllKeys,
  disenchantChampionShards,
  disenchantSkinShards,
  redeemAffordableChampionShards,
  type LootSummary,
  type CraftProgress,
} from '@/lib/features/loot-helper'

export interface LootHelperModalProps {
  open: boolean
  onClose: () => void
}

type RunningTask = null | 'openChests' | 'forgeKeys' | 'disenchantChamp' | 'disenchantSkin' | 'redeemChamp'

export function LootHelperModal({ open, onClose }: LootHelperModalProps) {
  const [summary, setSummary] = useState<LootSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<RunningTask>(null)
  const [progress, setProgress] = useState<CraftProgress | null>(null)
  const [resultLog, setResultLog] = useState<string[]>([])
  const [keepReserveStr, setKeepReserveStr] = useState('0')
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchLootSummary()
      setSummary(data)
    } catch (err) {
      setError(`加载战利品失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  // 弹窗打开时拉数据
  useEffect(() => {
    if (open) {
      setResultLog([])
      setProgress(null)
      setError('')
      refresh()
    }
  }, [open])

  const appendLog = (msg: string) => {
    setResultLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  // ============== 操作处理器 ==============

  const handleOpenAllChests = async () => {
    if (task) return
    if (!summary) return
    const totalChests = summary.chests.reduce((s, c) => s + c.count, 0) +
      summary.masterworkChests.reduce((s, c) => s + c.count, 0)
    if (totalChests === 0) {
      appendLog('当前没有可开的宝箱')
      return
    }
    if (!confirm(
      `确认要开启全部宝箱吗？\n\n` +
      `· 普通宝箱: ${summary.chests.reduce((s, c) => s + c.count, 0)} 个\n` +
      `· 大师宝箱: ${summary.masterworkChests.reduce((s, c) => s + c.count, 0)} 个\n` +
      `· 钥匙: ${summary.keyCount} 把（钥匙碎片: ${summary.keyFragmentCount}，会自动合成）`
    )) return

    setTask('openChests')
    setProgress({ stage: '开始', done: 0, total: 1 })
    try {
      const r = await openAllChests((p) => setProgress(p))
      appendLog(
        `🗝 开箱完成：合成 ${r.keysForged} 钥匙 / 开普通宝箱 ${r.chestsOpened} / 开大师宝箱 ${r.masterworksOpened}`,
      )
      await refresh()
    } catch (err) {
      appendLog(`❌ 开箱失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTask(null)
      setProgress(null)
    }
  }

  const handleForgeKeys = async () => {
    if (task) return
    if (!summary) return
    if (summary.keyFragmentCount < 3) {
      appendLog('钥匙碎片不足 3 个，无法合成')
      return
    }
    if (!confirm(`确认合成 ${Math.floor(summary.keyFragmentCount / 3)} 把钥匙吗？`)) return

    setTask('forgeKeys')
    setProgress({ stage: '合成钥匙', done: 0, total: 1 })
    try {
      const made = await forgeAllKeys((p) => setProgress(p))
      appendLog(`🔑 合成完成：${made} 把钥匙`)
      await refresh()
    } catch (err) {
      appendLog(`❌ 合成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTask(null)
      setProgress(null)
    }
  }

  const handleDisenchantChamp = async (onlyOwned: boolean) => {
    if (task) return
    if (!summary) return
    const targets = summary.championShards.filter((s) =>
      onlyOwned ? s.redeemableStatus === 'ALREADY_OWNED' : true,
    )
    const total = targets.reduce((sum, s) => sum + s.count, 0)
    const expected = targets.reduce(
      (sum, s) => sum + s.count * (s.disenchantValue ?? 0),
      0,
    )
    if (total === 0) {
      appendLog(onlyOwned ? '没有"已拥有英雄"的碎片可分解' : '没有英雄碎片可分解')
      return
    }
    if (!confirm(
      `确认分解 ${total} 个英雄碎片吗？\n\n` +
      `范围：${onlyOwned ? '仅已拥有英雄的碎片' : '全部英雄碎片（包括未拥有的，慎重！）'}\n` +
      `预计获得 ≈ ${expected} 蓝色精粹`
    )) return

    setTask('disenchantChamp')
    setProgress({ stage: '分解英雄碎片', done: 0, total })
    try {
      const r = await disenchantChampionShards(onlyOwned, (p) => setProgress(p))
      appendLog(`💎 分解完成：${r.disenchanted} 个碎片 → +${r.blueEssenceGained} 蓝精`)
      await refresh()
    } catch (err) {
      appendLog(`❌ 分解失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTask(null)
      setProgress(null)
    }
  }

  const handleDisenchantSkin = async (onlyOwned: boolean) => {
    if (task) return
    if (!summary) return
    const targets = summary.skinShards.filter((s) =>
      onlyOwned ? s.redeemableStatus === 'ALREADY_OWNED' : true,
    )
    const total = targets.reduce((sum, s) => sum + s.count, 0)
    const expected = targets.reduce(
      (sum, s) => sum + s.count * (s.disenchantValue ?? 0),
      0,
    )
    if (total === 0) {
      appendLog(onlyOwned ? '没有"已拥有皮肤"的碎片可分解' : '没有皮肤碎片可分解')
      return
    }
    if (!confirm(
      `确认分解 ${total} 个皮肤碎片吗？\n\n` +
      `范围：${onlyOwned ? '仅已拥有皮肤的碎片' : '全部皮肤碎片（包括未拥有的，慎重！）'}\n` +
      `预计获得 ≈ ${expected} 橙色精粹`
    )) return

    setTask('disenchantSkin')
    setProgress({ stage: '分解皮肤碎片', done: 0, total })
    try {
      const r = await disenchantSkinShards(onlyOwned, (p) => setProgress(p))
      appendLog(`🔶 分解完成：${r.disenchanted} 个皮肤碎片 → +${r.orangeEssenceGained} 橙精`)
      await refresh()
    } catch (err) {
      appendLog(`❌ 分解失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTask(null)
      setProgress(null)
    }
  }

  const handleRedeemChamp = async () => {
    if (task) return
    if (!summary) return
    const reserve = Math.max(0, parseInt(keepReserveStr, 10) || 0)
    const candidates = summary.championShards.filter(
      (s) => s.redeemableStatus === 'NOT_OWNED' && s.count > 0,
    )
    if (candidates.length === 0) {
      appendLog('没有"未拥有英雄"的碎片可激活')
      return
    }
    if (!confirm(
      `确认用蓝色精粹激活够买的英雄碎片吗？\n\n` +
      `当前蓝精：${summary.blueEssence}\n` +
      `保留余额：${reserve}\n` +
      `可消费：${Math.max(0, summary.blueEssence - reserve)}\n` +
      `\n规则：从最便宜的英雄开始激活，激活到精粹不够为止。`
    )) return

    setTask('redeemChamp')
    setProgress({ stage: '激活英雄碎片', done: 0, total: candidates.length })
    try {
      const r = await redeemAffordableChampionShards(reserve, (p) => setProgress(p))
      appendLog(`✨ 激活完成：${r.redeemed} 个永久英雄 / -${r.blueEssenceSpent} 蓝精`)
      await refresh()
    } catch (err) {
      appendLog(`❌ 激活失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTask(null)
      setProgress(null)
    }
  }

  // ============== 渲染 ==============

  const championShardCount = summary?.championShards.reduce((s, c) => s + c.count, 0) ?? 0
  const skinShardCount = summary?.skinShards.reduce((s, c) => s + c.count, 0) ?? 0
  const ownedChampionShardCount = summary?.championShards
    .filter((s) => s.redeemableStatus === 'ALREADY_OWNED')
    .reduce((s, c) => s + c.count, 0) ?? 0
  const ownedSkinShardCount = summary?.skinShards
    .filter((s) => s.redeemableStatus === 'ALREADY_OWNED')
    .reduce((s, c) => s + c.count, 0) ?? 0
  const chestCount = summary?.chests.reduce((s, c) => s + c.count, 0) ?? 0
  const masterworkCount = summary?.masterworkChests.reduce((s, c) => s + c.count, 0) ?? 0

  const isBusy = !!task

  return (
    <Modal open={open} onClose={onClose} width={680} height={620}>
      <div style={{
        padding: '24px 28px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        color: '#e8e3d3',
      }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>♫ 战利品助手</h2>
        <p className="sona-subtitle" style={{ margin: '4px 0 18px' }}>
          一键开宝箱、合钥匙、分解 / 激活碎片。所有破坏性操作均会二次确认。
        </p>

        {/* 概览数值 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginBottom: 14,
        }}>
          <Stat label="蓝色精粹" value={summary?.blueEssence ?? '—'} loading={loading} />
          <Stat label="橙色精粹" value={summary?.orangeEssence ?? '—'} loading={loading} />
          <Stat label="钥匙 / 碎片" value={summary ? `${summary.keyCount} / ${summary.keyFragmentCount}` : '—'} loading={loading} />
          <Stat label="宝箱 (普 / 大师)" value={summary ? `${chestCount} / ${masterworkCount}` : '—'} loading={loading} />
          <Stat label="英雄碎片 (总)" value={championShardCount} loading={loading} />
          <Stat label="英雄碎片 (已拥有)" value={ownedChampionShardCount} loading={loading} />
          <Stat label="皮肤碎片 (总)" value={skinShardCount} loading={loading} />
          <Stat label="皮肤碎片 (已拥有)" value={ownedSkinShardCount} loading={loading} />
        </div>

        {error && (
          <p style={{ color: '#ff8080', margin: '4px 0 10px' }}>{error}</p>
        )}

        {/* 操作按钮组 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <SonaButton
            variant="primary"
            disabled={isBusy || !summary || (chestCount + masterworkCount === 0)}
            onClick={handleOpenAllChests}
          >
            🗝 一键开全部宝箱
          </SonaButton>
          <SonaButton
            disabled={isBusy || !summary || (summary?.keyFragmentCount ?? 0) < 3}
            onClick={handleForgeKeys}
          >
            🔑 合成所有钥匙
          </SonaButton>
          <SonaButton
            disabled={isBusy || ownedChampionShardCount === 0}
            onClick={() => handleDisenchantChamp(true)}
          >
            ♻️ 分解已拥有英雄碎片
          </SonaButton>
          <SonaButton
            disabled={isBusy || ownedSkinShardCount === 0}
            onClick={() => handleDisenchantSkin(true)}
          >
            ♻️ 分解已拥有皮肤碎片
          </SonaButton>
        </div>

        {/* 蓝精激活英雄区 */}
        <div style={{
          border: '1px solid rgba(200, 170, 110, 0.2)',
          borderRadius: 6,
          padding: '10px 12px',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>用蓝精激活英雄碎片，保留余额：</span>
            <div style={{ width: 100 }}>
              <SonaInput
                value={keepReserveStr}
                onChange={(v) => setKeepReserveStr(v.replace(/[^\d]/g, ''))}
                placeholder="0"
              />
            </div>
            <SonaButton
              disabled={isBusy || !summary || summary.championShards.every((s) => s.redeemableStatus === 'ALREADY_OWNED')}
              onClick={handleRedeemChamp}
            >
              ✨ 一键激活
            </SonaButton>
          </div>
          <p className="sona-subtitle" style={{ margin: '6px 0 0', fontSize: 12 }}>
            从最便宜的英雄碎片开始激活，激活到蓝精剩余 ≤ 保留值时停止。
          </p>
        </div>

        {/* 进度 + 日志 */}
        <div style={{
          flex: 1,
          minHeight: 0,
          background: 'rgba(0, 0, 0, 0.18)',
          border: '1px solid rgba(200, 170, 110, 0.15)',
          borderRadius: 6,
          padding: '10px 12px',
          fontSize: 12,
          fontFamily: 'Consolas, Menlo, monospace',
          color: '#cfc7b4',
          overflow: 'auto',
        }}>
          {progress && (
            <div style={{ marginBottom: 6, color: '#f5d68b' }}>
              ⏳ {progress.stage} —— {progress.done} / {progress.total}
              <div style={{
                marginTop: 4,
                height: 4,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${progress.total ? Math.round(100 * progress.done / progress.total) : 0}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #c8aa6e, #f5d68b)',
                  transition: 'width 0.2s',
                }} />
              </div>
            </div>
          )}
          {resultLog.length === 0 && !progress && (
            <p style={{ opacity: 0.5, margin: 0 }}>
              {loading ? '加载战利品中...' : '点击上方按钮开始操作。所有动作均通过 LCU 官方 API 执行。'}
            </p>
          )}
          {resultLog.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <SonaButton onClick={refresh} disabled={isBusy}>刷新</SonaButton>
          <SonaButton variant="secondary" onClick={onClose} disabled={isBusy}>关闭</SonaButton>
        </div>
      </div>
    </Modal>
  )
}

// 数值小卡片
function Stat({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(200, 170, 110, 0.15)',
      borderRadius: 6,
      padding: '8px 10px',
      minHeight: 50,
    }}>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#f5d68b' }}>
        {loading && value === '—' ? '...' : value}
      </div>
    </div>
  )
}
