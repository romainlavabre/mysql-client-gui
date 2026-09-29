// Progress of background jobs (dumps, exports, imports) and the import / export dialogs.
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JobProgress } from '@shared/types'
import { api, onEvent } from '../../lib/bridge'
import { formatBytes, formatNumber } from '../../lib/format'
import { invalidateSchema } from '../../lib/actions'
import { IoDialogs } from './IoDialogs'

/** Byte-based jobs (SQL import) report bytes; the others rows. */
function progressText(job: JobProgress): string {
  const isBytes = job.label.startsWith('Import ') && !job.label.startsWith('Import into')
  const format = isBytes ? formatBytes : formatNumber
  if (job.total) return `${format(job.done)} / ${format(job.total)}`
  return isBytes ? format(job.done) : `${format(job.done)} rows`
}

export function JobsPanel() {
  const [jobs, setJobs] = useState<JobProgress[]>([])
  const queryClient = useQueryClient()

  useEffect(
    () =>
      onEvent('job:progress', (progress) => {
        setJobs((current) => {
          const others = current.filter((j) => j.jobId !== progress.jobId)
          return [...others, progress]
        })
        if (progress.finished && !progress.error && progress.label.startsWith('Import')) void invalidateSchema(queryClient)
      }),
    [queryClient]
  )

  return (
    <>
      {jobs.length > 0 && (
        <div className="fixed bottom-9 left-16 z-50 flex w-96 flex-col gap-2">
          {jobs.map((job) => {
            const percent = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : null
            return (
              <div key={job.jobId} className="rounded-md border border-border bg-panel-2 p-3 shadow-xl">
                <div className="flex items-center gap-2 text-xs">
                  {!job.finished ? (
                    <Loader2 className="size-4 animate-spin text-accent" />
                  ) : job.error ? (
                    <XCircle className="size-4 text-danger" />
                  ) : (
                    <CheckCircle2 className="size-4 text-success" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{job.label}</span>
                  {!job.finished ? (
                    <button className="text-muted hover:text-danger" onClick={() => void api.io.cancelJob({ jobId: job.jobId })}>
                      Cancel
                    </button>
                  ) : (
                    <button className="text-muted hover:text-fg" onClick={() => setJobs((c) => c.filter((j) => j.jobId !== job.jobId))} aria-label="Dismiss">
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                {!job.finished && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-bg">
                    <div className={percent === null ? 'h-full w-1/3 animate-pulse bg-accent' : 'h-full bg-accent transition-all'} style={percent === null ? undefined : { width: `${percent}%` }} />
                  </div>
                )}
                <div className="mt-1.5 text-[11px] text-muted">
                  {job.error ? <span className="text-danger">{job.error}</span> : job.finished ? `Done — ${progressText(job)}` : progressText(job)}
                </div>
                {job.warnings.length > 0 && (
                  <details className="mt-1 text-[11px] text-warning">
                    <summary className="cursor-pointer">{job.warnings.length} error(s) skipped</summary>
                    <div className="selectable mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap">{job.warnings.join('\n')}</div>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
      <IoDialogs />
    </>
  )
}
