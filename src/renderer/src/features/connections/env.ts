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

/** Connection colors of Beekeeper Studio (its dark theme brand colors). */
export const CONNECTION_COLORS: { name: string; value: string }[] = [
  { name: 'Red', value: '#ff5d59' },
  { name: 'Orange', value: '#ff8d21' },
  { name: 'Yellow', value: '#fad83b' },
  { name: 'Green', value: '#15db95' },
  { name: 'Blue', value: '#4ad0ff' },
  { name: 'Purple', value: '#9858ff' },
  { name: 'Pink', value: '#ff78f7' }
]
