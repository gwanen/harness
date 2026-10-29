const STOPPED = 'Request stopped by usage-credit-guard.'

function stopped(e, reason = 'Approval was not granted') {
  return {
    turnId: e.turnId,
    index: e.index,
    answer: `${STOPPED} ${reason}.`,
    toolUses: [],
    stopReason: null,
    usage: null,
  }
}

async function checkUsage($) {
  const usage = await $.session.usage()
  const limits = usage?.rateLimits
  if (!Array.isArray(limits)) return { blocked: true, reason: 'Usage data is unavailable' }

  const fiveHour = limits.find(limit => limit?.kind === 'five_hour')
  const sevenDay = limits.find(limit => limit?.kind === 'seven_day')
  const known = [fiveHour?.percentUsed, sevenDay?.percentUsed]
  if (known.some(value => !Number.isFinite(value) || value < 0)) {
    return { blocked: true, reason: resetReason('Five-hour or seven-day usage data is missing or invalid', [fiveHour, sevenDay]) }
  }

  const exhausted = []
  if (fiveHour.percentUsed >= 100) exhausted.push('five-hour')
  if (sevenDay.percentUsed >= 100) exhausted.push('seven-day')
  return exhausted.length
    ? { blocked: true, reason: resetReason(`${exhausted.join(' and ')} usage is at or above 100%`, [fiveHour, sevenDay].filter(limit => limit.percentUsed >= 100)) }
    : { blocked: false }
}

function resetReason(reason, relevant) {
  const resetTimes = relevant
    .map(limit => {
      if (typeof limit?.resetsAt !== 'string') return undefined
      const time = Date.parse(limit.resetsAt)
      if (!Number.isFinite(time)) return undefined
      const name = limit.kind === 'five_hour' ? 'five-hour' : 'seven-day'
      return `${name} resets ${new Date(time).toISOString()}`
    })
    .filter(Boolean)
  return resetTimes.length ? `${reason}; ${resetTimes.join('; ')}` : reason
}

async function allowBlocked($, reason, description) {
  try {
    const answer = await $.ui.ask(
      `Usage credit guard: ${reason}. This request may use paid usage credits. Allow this one ${description}?`,
      ['Stop', 'Allow this request'],
    )
    return answer === 'Allow this request'
  } catch {
    return false
  }
}

export function register(on) {
  on('turn.step', async function* ($, e, next) {
    let usage
    try {
      usage = await checkUsage($)
    } catch {
      usage = { blocked: true, reason: 'Usage data could not be read' }
    }

    if (usage.blocked && !(await allowBlocked($, usage.reason, `request for ${e.model}`))) {
      return stopped(e, usage.reason)
    }
    return yield* next(e)
  }).catch(async function* ($, e, next) {
    return stopped(e, 'The guard failed and did not approve the request')
  })

  // These are separate paid-request APIs exposed to mods, outside turn.step.
  on('model.complete', guardModelApi).catch(refuseModelApiFailure)
  on('model.fork', guardModelApi).catch(refuseModelApiFailure)
  on('model.classify', guardModelApi).catch(refuseModelApiFailure)
}

async function guardModelApi($, e, next) {
  let usage
  try {
    usage = await checkUsage($)
  } catch {
    usage = { blocked: true, reason: 'Usage data could not be read' }
  }
  if (!usage.blocked) return next(e)
  const description = e.model ? `request for ${e.model}` : 'model API request'
  if (await allowBlocked($, usage.reason, description)) return next(e)
  return { deny: `Request stopped by usage-credit-guard: ${usage.reason}.` }
}

async function refuseModelApiFailure($, e, next) {
  return { deny: 'Request stopped by usage-credit-guard because its guard failed.' }
}
