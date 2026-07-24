import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getCompetitionAvailability } from '../lib/competition-policy'

const now = new Date('2026-07-22T10:00:00.000Z')
const base = {
  lifecycle: 'active' as const,
  isActive: true,
  startsAt: new Date('2026-07-22T09:00:00.000Z'),
  endsAt: new Date('2026-07-22T11:00:00.000Z'),
  audience: 'all' as const,
  requiresVerifiedEmail: false,
}
const user = { emailVerified: true, createdAt: new Date('2026-01-01T00:00:00.000Z') }

describe('competition availability policy', () => {
  test('allows active and scheduled competitions during their window', () => {
    assert.deepEqual(getCompetitionAvailability(base, user, now), { ok: true })
    assert.deepEqual(
      getCompetitionAvailability({ ...base, lifecycle: 'scheduled' }, user, now),
      { ok: true },
    )
  })

  test('blocks before start and after end', () => {
    const before = getCompetitionAvailability(
      { ...base, startsAt: new Date('2026-07-22T10:01:00.000Z') },
      user,
      now,
    )
    const after = getCompetitionAvailability(
      { ...base, endsAt: new Date('2026-07-22T10:00:00.000Z') },
      user,
      now,
    )
    assert.equal(before.ok, false)
    assert.equal(before.ok ? null : before.code, 'NOT_STARTED')
    assert.equal(after.ok, false)
    assert.equal(after.ok ? null : after.code, 'ENDED')
  })

  test('enforces verified and account-age audiences', () => {
    const unverified = getCompetitionAvailability(
      { ...base, audience: 'verified', requiresVerifiedEmail: true },
      { ...user, emailVerified: false },
      now,
    )
    const oldInNewOnly = getCompetitionAvailability(
      { ...base, audience: 'new_users' },
      user,
      now,
    )
    const newInExistingOnly = getCompetitionAvailability(
      { ...base, audience: 'existing_users' },
      { ...user, createdAt: new Date('2026-07-10T00:00:00.000Z') },
      now,
    )
    assert.equal(unverified.ok ? null : unverified.code, 'EMAIL_NOT_VERIFIED')
    assert.equal(oldInNewOnly.ok ? null : oldInNewOnly.code, 'AUDIENCE_NEW_ONLY')
    assert.equal(newInExistingOnly.ok ? null : newInExistingOnly.code, 'AUDIENCE_EXISTING_ONLY')
  })
})
