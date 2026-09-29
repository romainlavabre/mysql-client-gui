// Small JSON file store with atomic writes, for local (never shared) app data.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class JsonStore<T> {
  private cache: T | null = null

  constructor(
    private readonly filePath: string,
    private readonly defaults: () => T
  ) {}

  read(): T {
    if (this.cache) return this.cache
    try {
      this.cache = { ...this.defaults(), ...JSON.parse(readFileSync(this.filePath, 'utf8')) } as T
    } catch {
      this.cache = this.defaults()
    }
    return this.cache
  }

  write(value: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(temporary, this.filePath)
    this.cache = value
  }

  update(change: (value: T) => T | void): T {
    const current = structuredClone(this.read())
    const next = change(current) ?? current
    this.write(next)
    return next
  }
}
