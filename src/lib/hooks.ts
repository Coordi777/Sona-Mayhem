import { useState, useEffect, useCallback } from 'react'
import { lcu } from './lcu'
import { computeTodayStats, getCachedTodayStats, type TodayStats } from './today-stats'

/**
 * React hook for fetching LCU API data
 */
export function useLcuData<T>(endpoint: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    if (!endpoint) return

    setLoading(true)
    setError(null)

    try {
      const result = await lcu.get<T>(endpoint)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

/**
 * React hook for current summoner data
 */
export function useCurrentSummoner() {
  return useLcuData<{
    accountId: number
    displayName: string
    gameName: string
    tagLine: string
    profileIconId: number
    summonerId: number
    summonerLevel: number
  }>('/lol-summoner/v1/current-summoner')
}

/**
 * 今日战绩 hook
 *
 * 拉自己最近 100 场对局，过滤今日（本地时区 0:00 起算）后聚合胜率。
 * 5 分钟缓存 + 并发去重，多个组件同时挂载只发一次请求。
 *
 * @param force 是否强制刷新（忽略缓存）
 */
export function useTodayStats(force = false) {
  const [data, setData] = useState<TodayStats | null>(getCachedTodayStats())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await computeTodayStats(force)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [force])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const refetch = useCallback(() => {
    return computeTodayStats(true).then((result) => {
      setData(result)
      return result
    })
  }, [])

  return { data, loading, error, refetch }
}
