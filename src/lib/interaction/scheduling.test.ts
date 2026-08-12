import { describe, expect, it } from 'vitest'

import {
  acceptSequence,
  completeSingleFlight,
  createSequenceGuard,
  createSingleFlightState,
  issueSequence,
  requestSingleFlight,
} from './scheduling'

describe('sequence guard', () => {
  it('rejects a frame when a newer request has been issued', () => {
    const first = issueSequence(createSequenceGuard())
    const second = issueSequence(first.state)

    expect(acceptSequence(second.state, first.sequence).accepted).toBe(false)
    const latest = acceptSequence(second.state, second.sequence)
    expect(latest.accepted).toBe(true)
    expect(latest.state.latestAccepted).toBe(second.sequence)
  })

  it('rejects duplicate and unknown responses', () => {
    const issued = issueSequence(createSequenceGuard())
    const accepted = acceptSequence(issued.state, issued.sequence)
    expect(acceptSequence(accepted.state, issued.sequence).accepted).toBe(false)
    expect(acceptSequence(accepted.state, 99).accepted).toBe(false)
  })
})
describe('single-flight transitions', () => {
  it('starts immediately while idle', () => {
    const transition = requestSingleFlight(createSingleFlightState())
    expect(transition).toEqual({
      state: { inFlight: true, queued: false },
      start: true,
    })
  })

  it('coalesces concurrent requests into one queued follow-up', () => {
    const first = requestSingleFlight(createSingleFlightState())
    const queuedOnce = requestSingleFlight(first.state)
    const queuedTwice = requestSingleFlight(queuedOnce.state)
    expect(queuedTwice).toEqual({
      state: { inFlight: true, queued: true },
      start: false,
    })

    const followUp = completeSingleFlight(queuedTwice.state)
    expect(followUp).toEqual({
      state: { inFlight: true, queued: false },
      start: true,
    })
    expect(completeSingleFlight(followUp.state)).toEqual({
      state: { inFlight: false, queued: false },
      start: false,
    })
  })
})
