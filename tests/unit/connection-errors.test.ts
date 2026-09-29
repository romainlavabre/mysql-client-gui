import { describe, expect, it } from 'vitest'
import { explainConnectionError } from '../../src/main/db/session'

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
