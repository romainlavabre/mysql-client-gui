import { describe, expect, it } from 'vitest'
import { bitToNumber, explainConnectionError } from '../../src/main/db/session'

describe('explainConnectionError', () => {
  it('explains self-signed certificates', () => {
    const error = Object.assign(new Error('self signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
    const explained = explainConnectionError(error)
    expect(explained.message).toMatch(/uncheck "Verify the server certificate"/)
    expect(explained.message).toContain('self signed certificate in certificate chain')
  })
  it('explains servers requiring TLS', () => {
    expect(explainConnectionError(new Error('Connections using insecure transport are prohibited while --require_secure_transport=ON.')).message).toMatch(
      /enable SSL/
    )
  })
  it('keeps other errors unchanged', () => {
    const error = new Error("Access denied for user 'x'@'y'")
    expect(explainConnectionError(error)).toBe(error)
  })
})

describe('bitToNumber', () => {
  it('reads BIT values as integers', () => {
    expect(bitToNumber(new Uint8Array([1]))).toBe(1)
    expect(bitToNumber(new Uint8Array([0]))).toBe(0)
    expect(bitToNumber(new Uint8Array([1, 0]))).toBe(256)
    expect(bitToNumber(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('18446744073709551615')
    expect(bitToNumber(null)).toBeNull()
  })
})
