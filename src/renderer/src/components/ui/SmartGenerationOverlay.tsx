import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { CircleX } from 'lucide-react'

import {
  formatSmartGenerationElapsedSeconds,
  getSmartGenerationPhaseLabel,
  resolveSmartGenerationFriendlyErrorMessage,
  type SmartGenerationPhase
} from './smartGenerationOverlayHelpers'

export type { SmartGenerationPhase } from './smartGenerationOverlayHelpers'

export interface SmartGenerationOverlayProps {
  phase: SmartGenerationPhase
  errorMessage?: string | null
}

export function SmartGenerationOverlay({
  phase,
  errorMessage = null
}: SmartGenerationOverlayProps): React.JSX.Element | null {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [visibleErrorMessage, setVisibleErrorMessage] = useState('')
  const elapsedSecondsRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)
  const hideErrorTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds
  }, [elapsedSeconds])

  useEffect(() => {
    return () => {
      if (hideErrorTimeoutRef.current !== null) {
        window.clearTimeout(hideErrorTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const friendlyErrorMessage = resolveSmartGenerationFriendlyErrorMessage(errorMessage)
    let intervalId: number | null = null

    if (hideErrorTimeoutRef.current !== null) {
      window.clearTimeout(hideErrorTimeoutRef.current)
      hideErrorTimeoutRef.current = null
    }

    if (phase) {
      setVisibleErrorMessage('')
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now()
        setElapsedSeconds(0)
      }

      const updateElapsedSeconds = (): void => {
        if (startedAtRef.current === null) {
          setElapsedSeconds(0)
          return
        }
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)))
      }

      updateElapsedSeconds()
      intervalId = window.setInterval(updateElapsedSeconds, 1000)
      return () => {
        if (intervalId !== null) {
          window.clearInterval(intervalId)
        }
      }
    }

    if (friendlyErrorMessage) {
      const finalElapsedSeconds =
        startedAtRef.current === null
          ? elapsedSecondsRef.current
          : Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
      setElapsedSeconds(finalElapsedSeconds)
      setVisibleErrorMessage(friendlyErrorMessage)
      hideErrorTimeoutRef.current = window.setTimeout(() => {
        startedAtRef.current = null
        setElapsedSeconds(0)
        setVisibleErrorMessage('')
        hideErrorTimeoutRef.current = null
      }, 3000)
      return undefined
    }

    setVisibleErrorMessage('')
    if (startedAtRef.current === null) {
      setElapsedSeconds(0)
      return undefined
    }

    startedAtRef.current = null
    setElapsedSeconds(0)
    return undefined
  }, [phase, errorMessage])

  if (!phase && !visibleErrorMessage) return null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.9),rgba(24,24,27,0.94))] px-4 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[10px]">
      <div className="flex flex-col items-center gap-2">
        {visibleErrorMessage ? (
          <>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-400/50 bg-rose-500/12 text-rose-300">
              <CircleX className="h-4.5 w-4.5" />
            </span>
            <div className="text-[13px] font-medium tracking-[0.02em] text-rose-100">
              {visibleErrorMessage}
            </div>
          </>
        ) : (
          <>
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-500 border-t-sky-300" />
            <div className="text-[13px] font-medium tracking-[0.02em] text-zinc-50">
              {getSmartGenerationPhaseLabel(phase)}
            </div>
          </>
        )}
        <div
          className={
            visibleErrorMessage
              ? 'text-[11px] tracking-[0.04em] text-rose-200/80'
              : 'text-[11px] tracking-[0.04em] text-zinc-300'
          }
        >
          {formatSmartGenerationElapsedSeconds(elapsedSeconds)}
        </div>
      </div>
    </div>
  )
}
