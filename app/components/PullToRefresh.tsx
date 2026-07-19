"use client"

import { useEffect, useRef, useState } from "react"

const PULL_THRESHOLD = 70
const MAX_PULL = 110
const RESISTANCE = 0.5

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const touchStartY = useRef<number | null>(null)

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (refreshing || window.scrollY > 0) {
        touchStartY.current = null
        return
      }
      touchStartY.current = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (touchStartY.current === null) return
      const delta = e.touches[0].clientY - touchStartY.current

      if (delta <= 0 || window.scrollY > 0) {
        touchStartY.current = null
        setDragging(false)
        setPullDistance(0)
        return
      }

      e.preventDefault()
      setDragging(true)
      setPullDistance(Math.min(delta * RESISTANCE, MAX_PULL))
    }

    function onTouchEnd() {
      if (touchStartY.current === null) return
      touchStartY.current = null
      setDragging(false)

      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true)
          window.location.reload()
          return PULL_THRESHOLD
        }
        return 0
      })
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
    }
  }, [refreshing])

  const offset = refreshing ? PULL_THRESHOLD : pullDistance
  const ready = offset >= PULL_THRESHOLD

  return (
    <div
      style={{
        transform: offset > 0 ? `translateY(${offset}px)` : undefined,
        transition: dragging ? "none" : "transform 0.25s ease"
      }}
      className="relative min-h-full"
    >
      <div
        className="absolute left-0 right-0 flex items-center justify-center"
        style={{ top: -56, height: 56, opacity: offset > 0 ? 1 : 0 }}
      >
        <span
          className={`w-7 h-7 rounded-full border-[3px] border-hairline ${
            refreshing || ready ? "border-t-gold animate-spin" : "border-t-gold"
          }`}
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${(offset / PULL_THRESHOLD) * 360}deg)` }
          }
        />
      </div>
      {children}
    </div>
  )
}
