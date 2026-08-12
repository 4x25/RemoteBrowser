export interface SequenceGuardState {
  nextSequence: number
  latestIssued: number
  latestAccepted: number
}
export interface IssuedSequence {
  state: SequenceGuardState
  sequence: number
}

export interface SequenceAcceptance {
  state: SequenceGuardState
  accepted: boolean
}

export const createSequenceGuard = (): SequenceGuardState => ({
  nextSequence: 1,
  latestIssued: 0,
  latestAccepted: 0,
})

export function issueSequence(state: SequenceGuardState): IssuedSequence {
  const sequence = state.nextSequence
  return {
    sequence,
    state: {
      ...state,
      nextSequence: sequence + 1,
      latestIssued: sequence,
    },
  }
}

/** Accepts only the newest issued frame and rejects duplicate/late responses. */
export function acceptSequence(
  state: SequenceGuardState,
  sequence: number,
): SequenceAcceptance {
  const accepted =
    Number.isInteger(sequence) &&
    sequence === state.latestIssued &&
    sequence > state.latestAccepted

  return {
    accepted,
    state: accepted ? { ...state, latestAccepted: sequence } : state,
  }
}

export interface SingleFlightState {
  inFlight: boolean
  queued: boolean
}

export interface SingleFlightTransition {
  state: SingleFlightState
  start: boolean
}

export const createSingleFlightState = (): SingleFlightState => ({
  inFlight: false,
  queued: false,
})

/** Coalesces any number of requests made during one in-flight operation. */
export function requestSingleFlight(
  state: SingleFlightState,
): SingleFlightTransition {
  if (state.inFlight) {
    return { state: { inFlight: true, queued: true }, start: false }
  }
  return { state: { inFlight: true, queued: false }, start: true }
}

/**
 * Completes one operation. When `start` is true the caller should immediately
 * launch the single queued follow-up; state remains in-flight for that launch.
 */
export function completeSingleFlight(
  state: SingleFlightState,
): SingleFlightTransition {
  if (!state.inFlight) return { state, start: false }
  if (state.queued) {
    return { state: { inFlight: true, queued: false }, start: true }
  }
  return { state: { inFlight: false, queued: false }, start: false }
}
