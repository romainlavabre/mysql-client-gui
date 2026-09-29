import type { EnvTag } from '@shared/types'

export const ENV_COLORS: Record<EnvTag, string> = {
  dev: '#4cc38a',
  staging: '#f0a33c',
  prod: '#ef5d5d',
  other: '#8b93a4'
}

export const ENV_LABELS: Record<EnvTag, string> = {
  dev: 'Development',
  staging: 'Staging',
  prod: 'Production',
  other: 'Other'
}
