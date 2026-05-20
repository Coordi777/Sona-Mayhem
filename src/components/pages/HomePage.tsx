import { useEffect, useRef } from 'react'
import '@/styles/HomePage.css'
import sonaIcon from '@assets/Champie_Sona_profileicon.png'
import { useTodayStats } from '@/lib/hooks'
import type { ModeStats } from '@/lib/today-stats'

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId = 0
    const particles: Array<{
      x: number; y: number
      vx: number; vy: number
      size: number; opacity: number
      life: number; maxLife: number
      isGold: boolean
    }> = []

    const resize = () => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.offsetWidth
        canvas.height = parent.offsetHeight
      }
    }

    const spawn = () => {
      const cx = canvas.width / 2
      const cy = canvas.height / 2
      const isGold = Math.random() > 0.35
      // 在头像圆形边缘附近生成
      const angle = Math.random() * Math.PI * 2
      const radius = 30 + Math.random() * 20
      particles.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(Math.random() * 0.12 + 0.05),
        size: Math.random() * 1.8 + 0.5,
        opacity: 0,
        life: 0,
        maxLife: 50 + Math.random() * 50,
        isGold,
      })
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // 每帧生成 1 个粒子
      if (particles.length < 80) {
        spawn()
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life++
        p.x += p.vx
        p.y += p.vy
        // 水平微微飘动
        p.vx += (Math.random() - 0.5) * 0.01
        // 向上的轻微加速（负重力，越飘越轻）
        p.vy -= 0.001

        // 前 20% 淡入，后 30% 淡出
        const progress = p.life / p.maxLife
        if (progress < 0.2) {
          p.opacity = (progress / 0.2) * 0.8
        } else if (progress > 0.7) {
          p.opacity = ((1 - progress) / 0.3) * 0.8
        }

        if (p.life >= p.maxLife) {
          particles.splice(i, 1)
          continue
        }

        if (p.isGold) {
          ctx.shadowBlur = 6
          ctx.shadowColor = `rgba(200, 170, 110, ${p.opacity})`
          ctx.fillStyle = `rgba(220, 190, 130, ${p.opacity})`
        } else {
          ctx.shadowBlur = 5
          ctx.shadowColor = `rgba(0, 180, 255, ${p.opacity * 0.8})`
          ctx.fillStyle = `rgba(100, 200, 255, ${p.opacity * 0.85})`
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'

      animId = requestAnimationFrame(render)
    }

    resize()
    window.addEventListener('resize', resize)
    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="sona-home-particle-canvas" />
}

export function HomePage() {
  return (
    <div className="sona-home">
      {/* SONA 标题 */}
      <h1 className="sona-home-brand">
        <span className="sona-home-brand-text">SONA</span>
      </h1>

      {/* 头像 + 粒子 */}
      <div className="sona-home-avatar-wrap">
        <ParticleCanvas />
        <div className="sona-home-avatar-glow" />
        <img
          className="sona-home-avatar"
          src={sonaIcon}
          alt="Sona"
          draggable={false}
        />
      </div>

      {/* 欢迎语 */}
      <div className="sona-home-welcome">
        <h2 className="sona-home-heading">欢迎使用 Sona</h2>
        <p className="sona-home-subtitle">
          你的英雄联盟客户端增强工具
        </p>
      </div>

      {/* 今日战绩 */}
      <TodayStatsCard />

      {/* 琴女语录 */}
      <p className="sona-home-quote">
        "本项目完全开源免费，如果你通过收费渠道使用，那你被骗啦!"
        <br />
        &nbsp;—— 神奇的WJZ_P
      </p>
    </div>
  )
}

// ==================== 今日战绩卡片 ====================

function TodayStatsCard() {
  const { data, loading, error, refetch } = useTodayStats()

  return (
    <div className="sona-home-today-stats">
      <div className="sona-home-today-stats-header">
        <span className="sona-home-today-stats-title">📊 今日战绩</span>
        <button
          className="sona-home-today-stats-refresh"
          onClick={() => { void refetch() }}
          disabled={loading}
          title="刷新"
        >
          {loading ? '加载中…' : '↻ 刷新'}
        </button>
      </div>

      {error ? (
        <div className="sona-home-today-stats-empty">
          ⚠ 加载失败：{error.message}
        </div>
      ) : !data || data.total === 0 ? (
        <div className="sona-home-today-stats-empty">
          {loading ? '加载中…' : '今天还没有对局，去打一把吧 ♫'}
        </div>
      ) : (
        <>
          <div className="sona-home-today-stats-summary">
            <span className={`sona-home-today-stats-rate ${getRateClass(data.winRate)}`}>
              {Math.round(data.winRate)}%
            </span>
            <span className="sona-home-today-stats-detail">
              共 <strong>{data.total}</strong> 局，
              <span className="win">{data.wins} 胜</span>
              {' / '}
              <span className="loss">{data.losses} 负</span>
            </span>
          </div>

          {data.byMode.length > 1 && (
            <div className="sona-home-today-stats-modes">
              {data.byMode.map((m) => (
                <ModeRow key={m.queueId} mode={m} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ModeRow({ mode }: { mode: ModeStats }) {
  return (
    <div className="sona-home-today-stats-mode">
      <span className="sona-home-today-stats-mode-name">{mode.name}</span>
      <span>
        {mode.wins}/{mode.total - mode.wins}
      </span>
      <span className="sona-home-today-stats-mode-rate">
        &nbsp;{Math.round(mode.winRate)}%
      </span>
    </div>
  )
}

function getRateClass(rate: number): string {
  if (rate >= 60) return 'sona-home-today-stats-rate--high'
  if (rate >= 45) return 'sona-home-today-stats-rate--mid'
  return 'sona-home-today-stats-rate--low'
}
