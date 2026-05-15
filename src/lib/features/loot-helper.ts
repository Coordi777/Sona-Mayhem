/**
 * 战利品助手 —— 一键开宝箱 / 合成钥匙 / 分解&激活碎片
 *
 * 设计思路：
 * 1. 不写死 recipe 名（国服/外服/不同版本可能不一样），改为通过
 *    `/lol-loot/v1/recipes/initial-item/{lootName}` 动态查询当前物品可执行的 recipe，
 *    再按 recipe.type（OPEN / FORGE / DISENCHANT / REDEEM）选择目标。
 * 2. 所有破坏性操作（分解/激活/开箱）都返回结构化结果，UI 层负责确认提示。
 * 3. 单次合成 repeat 上限按 50 截断，避免国服服务端节流踢回 429。
 */

import { lcu } from '@/lib/lcu'
import type { PlayerLootItem, LootRecipe } from '@/lib/lcu'
import { logger } from '@/index'

// ==================== 常量 ====================

/** 单次 craft repeat 上限（防止服务端节流） */
const MAX_REPEAT_PER_REQUEST = 50

/** 国服蓝色精粹 lootName */
const BLUE_ESSENCE_LOOT = 'CURRENCY_champion'
/** 国服橙色精粹 lootName */
const ORANGE_ESSENCE_LOOT = 'CURRENCY_cosmetic'
/** 国服紫色精粹 lootName（可选，部分版本叫 CURRENCY_mythic） */
const MYTHIC_ESSENCE_LOOT = 'CURRENCY_mythic'

// ==================== Loot 仓库分类 ====================

/** 战利品仓库统计摘要（UI 直接展示） */
export interface LootSummary {
  /** 蓝色精粹余额 */
  blueEssence: number
  /** 橙色精粹余额 */
  orangeEssence: number
  /** 紫色（神话）精粹余额 */
  mythicEssence: number
  /** 海克斯钥匙数 */
  keyCount: number
  /** 钥匙碎片数（3 个合成 1 把钥匙） */
  keyFragmentCount: number
  /** 普通海克斯宝箱（含特殊冠军/世界赛宝箱）— 全部需要钥匙 */
  chests: PlayerLootItem[]
  /** 大师/无主之宝/仪式宝箱 — 不需要钥匙，可直接开 */
  masterworkChests: PlayerLootItem[]
  /** 英雄碎片 */
  championShards: PlayerLootItem[]
  /** 皮肤碎片 */
  skinShards: PlayerLootItem[]
  /** 眼皮肤碎片 */
  wardShards: PlayerLootItem[]
  /** 表情碎片 */
  emoteShards: PlayerLootItem[]
  /** 全量原始数据（调试 / 进阶用） */
  raw: PlayerLootItem[]
}

/**
 * 拉战利品仓库并按类型分类
 */
export async function fetchLootSummary(): Promise<LootSummary> {
  const raw = await lcu.getPlayerLoot()

  const get = (name: string) =>
    raw.find((it) => it.lootName === name)?.count ?? 0

  // 普通宝箱（需要钥匙开）：lootName 通常是 CHEST_xxx
  // 大师宝箱（不需要钥匙）：lootName 含 _MASTERWORK 或类型为 CHEST 但子类是 MASTERWORK
  const chests: PlayerLootItem[] = []
  const masterworkChests: PlayerLootItem[] = []

  for (const item of raw) {
    if (item.type !== 'CHEST') continue
    if (item.count <= 0) continue
    const isMasterwork =
      /MASTERWORK/i.test(item.lootName) ||
      /大师宝箱|无主之宝|仪式宝箱/i.test(item.localizedName ?? '')
    if (isMasterwork) masterworkChests.push(item)
    else chests.push(item)
  }

  const championShards = raw.filter(
    (it) => it.type === 'CHAMPION_RENTAL' && it.count > 0,
  )
  const skinShards = raw.filter(
    (it) => it.type === 'SKIN_RENTAL' && it.count > 0,
  )
  const wardShards = raw.filter(
    (it) => it.type === 'WARDSKIN_RENTAL' && it.count > 0,
  )
  const emoteShards = raw.filter(
    (it) => it.type === 'EMOTE_RENTAL' && it.count > 0,
  )

  return {
    blueEssence: get(BLUE_ESSENCE_LOOT),
    orangeEssence: get(ORANGE_ESSENCE_LOOT),
    mythicEssence: get(MYTHIC_ESSENCE_LOOT),
    keyCount: get('MATERIAL_key'),
    keyFragmentCount: get('MATERIAL_key_fragment'),
    chests,
    masterworkChests,
    championShards,
    skinShards,
    wardShards,
    emoteShards,
    raw,
  }
}

// ==================== Recipe 选择工具 ====================

/**
 * 在 recipes 列表里按类型挑一个最合适的
 *
 * preferType 顺序按数组优先级降序：先匹配前面的 type，匹配不到再退化到后面的。
 * 兼容 OPEN / FORGE / DISENCHANT / REDEEM 等多种 enum。
 */
function pickRecipe(
  recipes: LootRecipe[],
  preferTypes: string[],
): LootRecipe | null {
  for (const t of preferTypes) {
    const found = recipes.find((r) => r.type?.toUpperCase().includes(t))
    if (found) return found
  }
  return null
}

/**
 * 找指定 lootName 上的 OPEN 类 recipe（开宝箱）
 *
 * 国服客户端有时同一宝箱会返回多个 OPEN recipe（普通开 + 自动分解开），
 * 这里默认选**第一个 OPEN**。如果用户希望自动分解，UI 层可改用其他 recipe。
 */
async function findOpenRecipe(lootName: string): Promise<string | null> {
  const recipes = await lcu.getLootRecipes(lootName)
  // 国服宝箱 recipeName 形如 CHEST_generic_OPEN / CHEST_241_OPEN
  // 优先选名字含 _OPEN 不含 _DISENCHANT 的
  const recipe =
    recipes.find(
      (r) => /_OPEN(?!.*DISENCHANT)/i.test(r.recipeName ?? '') ||
        r.type?.toUpperCase() === 'OPEN',
    ) ?? pickRecipe(recipes, ['OPEN'])
  return recipe?.recipeName ?? null
}

/**
 * 找钥匙碎片合钥匙的 recipe
 */
async function findKeyForgeRecipe(): Promise<string | null> {
  const recipes = await lcu.getLootRecipes('MATERIAL_key_fragment')
  // 经典名：MATERIAL_key_forge
  const recipe =
    recipes.find((r) => /forge/i.test(r.recipeName ?? '')) ??
    pickRecipe(recipes, ['FORGE', 'CRAFT'])
  return recipe?.recipeName ?? null
}

/**
 * 找英雄/皮肤碎片的「分解」recipe
 */
async function findDisenchantRecipe(lootName: string): Promise<string | null> {
  const recipes = await lcu.getLootRecipes(lootName)
  const recipe =
    recipes.find((r) => /DISENCHANT/i.test(r.recipeName ?? '')) ??
    pickRecipe(recipes, ['DISENCHANT'])
  return recipe?.recipeName ?? null
}

/**
 * 找英雄/皮肤碎片的「兑换永久」recipe
 */
async function findRedeemRecipe(lootName: string): Promise<string | null> {
  const recipes = await lcu.getLootRecipes(lootName)
  const recipe =
    recipes.find((r) => /REDEEM|UPGRADE/i.test(r.recipeName ?? '')) ??
    pickRecipe(recipes, ['REDEEM', 'UPGRADE'])
  return recipe?.recipeName ?? null
}

// ==================== 高层操作 ====================

export interface CraftProgress {
  /** 当前阶段名（用于 UI 进度条） */
  stage: string
  /** 当前步骤的进度数（已完成数量） */
  done: number
  /** 当前步骤的总量 */
  total: number
}

export type ProgressCallback = (p: CraftProgress) => void

/** 把一次 N 件的合成拆成多个 ≤ MAX_REPEAT_PER_REQUEST 的请求 */
async function craftInBatches(
  recipeName: string,
  lootIds: string[],
  total: number,
  onProgress?: ProgressCallback,
  stageLabel = '执行',
): Promise<number> {
  let crafted = 0
  let remaining = total
  while (remaining > 0) {
    const batch = Math.min(MAX_REPEAT_PER_REQUEST, remaining)
    try {
      await lcu.craftLootRecipe(recipeName, lootIds, batch)
      crafted += batch
      remaining -= batch
      onProgress?.({ stage: stageLabel, done: crafted, total })
    } catch (err) {
      logger.warn('[Loot] %s 合成失败 recipe=%s loot=%o batch=%d err=%o',
        stageLabel, recipeName, lootIds, batch, err)
      // 合成失败时直接跳出，避免无限重试占带宽
      break
    }
  }
  return crafted
}

/**
 * 把所有钥匙碎片合成钥匙（每 3 个 → 1 把）
 *
 * @returns 合成出的钥匙数
 */
export async function forgeAllKeys(onProgress?: ProgressCallback): Promise<number> {
  const summary = await fetchLootSummary()
  const fragments = summary.keyFragmentCount
  if (fragments < 3) return 0

  const recipeName = await findKeyForgeRecipe()
  if (!recipeName) {
    logger.warn('[Loot] 未找到钥匙碎片合成 recipe，跳过')
    return 0
  }

  // 一次合成消耗 3 个碎片，最多能合 floor(fragments / 3) 把
  const totalKeys = Math.floor(fragments / 3)
  const made = await craftInBatches(
    recipeName,
    ['MATERIAL_key_fragment'],
    totalKeys,
    onProgress,
    '合成钥匙',
  )
  logger.info('[Loot] 钥匙碎片合成完成：%d 把钥匙', made)
  return made
}

/**
 * 一键开所有海克斯宝箱（含大师宝箱）
 *
 * 流程：
 *   1. 先把所有钥匙碎片合成钥匙
 *   2. 用钥匙开普通宝箱（钥匙不够时只开能开的那部分）
 *   3. 顺手开大师宝箱（不需要钥匙）
 *
 * @returns { keysForged, chestsOpened, masterworksOpened }
 */
export async function openAllChests(onProgress?: ProgressCallback): Promise<{
  keysForged: number
  chestsOpened: number
  masterworksOpened: number
}> {
  // 第 1 步：合成所有钥匙碎片
  onProgress?.({ stage: '准备', done: 0, total: 1 })
  const keysForged = await forgeAllKeys(onProgress)

  // 第 2 步：刷新数据，看现在能开多少个宝箱
  let summary = await fetchLootSummary()
  const totalChests = summary.chests.reduce((sum, c) => sum + c.count, 0)
  const usableChests = Math.min(summary.keyCount, totalChests)

  let chestsOpened = 0
  let openedSoFar = 0

  if (usableChests > 0 && summary.chests.length > 0) {
    // 各种宝箱按数量从多到少处理（一般同型号宝箱优先批量开掉）
    const sortedChests = [...summary.chests].sort((a, b) => b.count - a.count)
    let keysLeft = summary.keyCount

    for (const chest of sortedChests) {
      if (keysLeft <= 0) break
      const openable = Math.min(chest.count, keysLeft)

      const recipeName = await findOpenRecipe(chest.lootName)
      if (!recipeName) {
        logger.warn('[Loot] 未找到 %s 的 OPEN recipe，跳过', chest.lootName)
        continue
      }

      const made = await craftInBatches(
        recipeName,
        [chest.lootName, 'MATERIAL_key'],
        openable,
        (p) => onProgress?.({
          stage: `开宝箱：${chest.localizedName ?? chest.lootName}`,
          done: openedSoFar + p.done,
          total: usableChests,
        }),
        `开 ${chest.localizedName ?? chest.lootName}`,
      )
      keysLeft -= made
      chestsOpened += made
      openedSoFar += made
    }
  }

  // 第 3 步：开大师宝箱（无需钥匙）
  // 重新拉一次数据，避免上一步开箱产生的新大师宝箱被漏掉
  summary = await fetchLootSummary()
  let masterworksOpened = 0
  const totalMaster = summary.masterworkChests.reduce((s, c) => s + c.count, 0)
  let masterDone = 0

  for (const chest of summary.masterworkChests) {
    if (chest.count <= 0) continue
    const recipeName = await findOpenRecipe(chest.lootName)
    if (!recipeName) {
      logger.warn('[Loot] 未找到大师宝箱 %s 的 OPEN recipe，跳过', chest.lootName)
      continue
    }
    const made = await craftInBatches(
      recipeName,
      [chest.lootName],
      chest.count,
      (p) => onProgress?.({
        stage: `开 ${chest.localizedName ?? chest.lootName}`,
        done: masterDone + p.done,
        total: totalMaster,
      }),
      `开 ${chest.localizedName ?? chest.lootName}`,
    )
    masterworksOpened += made
    masterDone += made
  }

  logger.info(
    '[Loot] 开箱完成：合成钥匙 %d 把 / 开普通宝箱 %d 个 / 开大师宝箱 %d 个',
    keysForged, chestsOpened, masterworksOpened,
  )

  return { keysForged, chestsOpened, masterworksOpened }
}

/**
 * 分解英雄碎片（按筛选条件）
 *
 * @param onlyOwned true=只分解已拥有该英雄永久的碎片（避免重复）；false=分解全部
 * @returns 分解的碎片总数 + 估算获得的蓝色精粹
 */
export async function disenchantChampionShards(
  onlyOwned: boolean,
  onProgress?: ProgressCallback,
): Promise<{ disenchanted: number; blueEssenceGained: number }> {
  const summary = await fetchLootSummary()

  const targets = summary.championShards.filter((s) => {
    if (!onlyOwned) return true
    // ALREADY_OWNED 表示该英雄已拥有永久；NOT_OWNED 表示尚未拥有
    return s.redeemableStatus === 'ALREADY_OWNED'
  })

  const totalCount = targets.reduce((sum, s) => sum + s.count, 0)
  if (totalCount === 0) return { disenchanted: 0, blueEssenceGained: 0 }

  let disenchanted = 0
  let blueEssenceGained = 0
  let progressDone = 0

  for (const shard of targets) {
    const recipeName = await findDisenchantRecipe(shard.lootName)
    if (!recipeName) {
      logger.warn('[Loot] 未找到 %s 的分解 recipe', shard.lootName)
      continue
    }

    const made = await craftInBatches(
      recipeName,
      [shard.lootName],
      shard.count,
      (p) => onProgress?.({
        stage: `分解英雄碎片：${shard.localizedName}`,
        done: progressDone + p.done,
        total: totalCount,
      }),
      `分解 ${shard.localizedName}`,
    )

    disenchanted += made
    blueEssenceGained += made * (shard.disenchantValue ?? 0)
    progressDone += made
  }

  logger.info(
    '[Loot] 英雄碎片分解完成：%d 个 / +%d 蓝精',
    disenchanted, blueEssenceGained,
  )
  return { disenchanted, blueEssenceGained }
}

/**
 * 用蓝色精粹激活够买的英雄碎片（永久）
 *
 * 算法：贪心 — 按"激活所需精粹值"从低到高激活，直到精粹不够为止。
 * 同一英雄如有多个碎片，激活第一个后剩下的视为重复（自动跳到下一个英雄）。
 *
 * @param keepReserve 保留多少蓝色精粹不动用（防止把精粹清零，默认 0）
 * @returns 激活的英雄数 + 总耗精粹
 */
export async function redeemAffordableChampionShards(
  keepReserve: number,
  onProgress?: ProgressCallback,
): Promise<{ redeemed: number; blueEssenceSpent: number }> {
  const summary = await fetchLootSummary()

  // 按所需精粹升序，相同精粹按稀有度（更稀有的优先）
  const candidates = summary.championShards
    .filter((s) => s.redeemableStatus === 'NOT_OWNED' && s.count > 0)
    .sort((a, b) => a.upgradeEssenceValue - b.upgradeEssenceValue)

  let budget = Math.max(0, summary.blueEssence - keepReserve)
  let redeemed = 0
  let blueEssenceSpent = 0
  const ownedChampIds = new Set<string>()

  for (let i = 0; i < candidates.length; i++) {
    const shard = candidates[i]
    if (shard.upgradeEssenceValue > budget) continue
    // 同一英雄只激活 1 次
    if (ownedChampIds.has(shard.refId)) continue
    if (shard.upgradeEssenceName !== BLUE_ESSENCE_LOOT) continue

    const recipeName = await findRedeemRecipe(shard.lootName)
    if (!recipeName) {
      logger.warn('[Loot] 未找到 %s 的兑换 recipe', shard.lootName)
      continue
    }

    try {
      await lcu.craftLootRecipe(recipeName, [shard.lootName], 1)
      redeemed += 1
      blueEssenceSpent += shard.upgradeEssenceValue
      budget -= shard.upgradeEssenceValue
      ownedChampIds.add(shard.refId)
      onProgress?.({
        stage: `激活：${shard.localizedName}`,
        done: redeemed,
        total: candidates.length,
      })
      logger.info('[Loot] 已激活英雄碎片 %s（-%d 蓝精，剩余 %d）',
        shard.localizedName, shard.upgradeEssenceValue, budget)
    } catch (err) {
      logger.warn('[Loot] 激活 %s 失败：%o', shard.localizedName, err)
    }
  }

  logger.info(
    '[Loot] 英雄碎片激活完成：%d 个 / -%d 蓝精',
    redeemed, blueEssenceSpent,
  )
  return { redeemed, blueEssenceSpent }
}

/**
 * 分解皮肤碎片（按筛选条件）
 *
 * @param onlyOwned true=只分解已拥有该皮肤永久的碎片
 */
export async function disenchantSkinShards(
  onlyOwned: boolean,
  onProgress?: ProgressCallback,
): Promise<{ disenchanted: number; orangeEssenceGained: number }> {
  const summary = await fetchLootSummary()

  const targets = summary.skinShards.filter((s) => {
    if (!onlyOwned) return true
    return s.redeemableStatus === 'ALREADY_OWNED'
  })

  const totalCount = targets.reduce((sum, s) => sum + s.count, 0)
  if (totalCount === 0) return { disenchanted: 0, orangeEssenceGained: 0 }

  let disenchanted = 0
  let orangeEssenceGained = 0
  let progressDone = 0

  for (const shard of targets) {
    const recipeName = await findDisenchantRecipe(shard.lootName)
    if (!recipeName) continue

    const made = await craftInBatches(
      recipeName,
      [shard.lootName],
      shard.count,
      (p) => onProgress?.({
        stage: `分解皮肤碎片：${shard.localizedName}`,
        done: progressDone + p.done,
        total: totalCount,
      }),
      `分解 ${shard.localizedName}`,
    )

    disenchanted += made
    orangeEssenceGained += made * (shard.disenchantValue ?? 0)
    progressDone += made
  }

  logger.info(
    '[Loot] 皮肤碎片分解完成：%d 个 / +%d 橙精',
    disenchanted, orangeEssenceGained,
  )
  return { disenchanted, orangeEssenceGained }
}
