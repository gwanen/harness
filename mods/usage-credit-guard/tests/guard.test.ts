import { expect, test } from 'claude-code/testing'
import { register } from '../hooks/register.js'

const input = { turnId: 'turn-test', index: 2, model: 'test-model', messageCount: 1 }
const fakeResult = {
  turnId: input.turnId,
  index: input.index,
  answer: 'test model result',
  toolUses: [],
  stopReason: 'end_turn',
  usage: null,
}

function handlers() {
  const registered = {}
  const on = (event, matcher, hook) => {
    if (typeof matcher === 'function') hook = matcher
    registered[event] = hook
    return { catch(handler) { registered[`${event}:catch`] = handler; return this } }
  }
  register(on)
  return registered
}

function startTurnStep(handler, usage, answer, event = input) {
  let calls = 0
  let resolveAsked
  const asked = new Promise(resolve => { resolveAsked = resolve })
  const $ = {
    session: { usage: async () => usage },
    ui: { ask: async (question, options) => { resolveAsked({ question, options }); return answer() } },
  }
  let received
  const next = async function* (passed) { calls += 1; received = passed; return fakeResult }
  next.called = false
  const done = (async () => {
    const stream = handler($, event, next)
    while (true) {
      const part = await stream.next()
      if (part.done) return { calls, received, result: part.value }
    }
  })()
  return { done, asked }
}

async function runModelApi(handler, usage, answer, called = false) {
  let calls = 0
  const $ = {
    session: { usage: async () => usage },
    ui: { ask: async (question, options) => { $.askArgs = { question, options }; return answer() } },
  }
  const next = async () => { calls += 1; return { value: 'test result' } }
  next.called = called
  const result = await handler($, {}, next)
  return { calls, result, askArgs: $.askArgs }
}

const limits = (fiveHour, sevenDay, fiveReset, sevenReset) => ({
  rateLimits: [
    ...(fiveHour === undefined ? [] : [{ kind: 'five_hour', percentUsed: fiveHour, ...(fiveReset ? { resetsAt: fiveReset } : {}) }]),
    ...(sevenDay === undefined ? [] : [{ kind: 'seven_day', percentUsed: sevenDay, ...(sevenReset ? { resetsAt: sevenReset } : {}) }]),
  ],
})

test('allows a subagent request below both limits', async () => {
  const event = { ...input, agentId: 'agent-123' }
  const run = startTurnStep(handlers()['turn.step'], limits(99, 40), () => 'Stop', event)
  const { calls, received, result } = await run.done
  expect(calls).toBe(1)
  expect(received.agentId).toBe('agent-123')
  expect(result.answer).toBe('test model result')
})

test('stops independently at either limit and shows reset time and possible paid usage', async () => {
  for (const usage of [limits(100, 40, '2026-10-29T12:00:00.000Z'), limits(40, 100, undefined, '2026-11-04T10:00:00.000Z')]) {
    const run = startTurnStep(handlers()['turn.step'], usage, () => 'Stop')
    const [{ question, options }, { calls, result }] = await Promise.all([run.asked, run.done])
    expect(calls).toBe(0)
    expect(result.usage).toBe(null)
    expect(question).toContain('may use paid usage credits')
    expect(question).toContain('resets 2026-')
    expect(options[0]).toBe('Stop')
  }
})

test('treats a missing window, empty usage, NaN, or negative percentage as unknown', async () => {
  const invalidUsage = [limits(40), { rateLimits: [] }, limits(Number.NaN, 12), limits(-1, 12)]
  for (const usage of invalidUsage) {
    const run = startTurnStep(handlers()['turn.step'], usage, () => 'Stop')
    const [{ question, options }, { calls, result }] = await Promise.all([run.asked, run.done])
    expect(calls).toBe(0)
    expect(result.usage).toBe(null)
    expect(question).toContain('may use paid usage credits')
    expect(options[0]).toBe('Stop')
  }
})

test('usage read failure and UI rejection deny by default', async () => {
  const run = startTurnStep(handlers()['turn.step'], Promise.reject(new Error('unavailable')), () => Promise.reject(new Error('headless')))
  const { calls, result } = await run.done
  expect(calls).toBe(0)
  expect(result.usage).toBe(null)
})

test('an approval applies to one request only', async () => {
  const hook = handlers()['turn.step']
  const first = startTurnStep(hook, limits(100, 100), () => 'Allow this request')
  const firstResult = await first.done
  const second = startTurnStep(hook, limits(100, 100), () => 'Stop')
  const secondResult = await second.done
  expect(firstResult.calls).toBe(1)
  expect(secondResult.calls).toBe(0)
})

test('concurrent approvals stay bound to their own blocked request', async () => {
  const hook = handlers()['turn.step']
  const decisions = []
  const first = startTurnStep(hook, limits(100, 30), () => new Promise(resolve => decisions.push({ id: 'five', resolve })), { ...input, turnId: 'five' })
  const second = startTurnStep(hook, limits(30, 100), () => new Promise(resolve => decisions.push({ id: 'seven', resolve })), { ...input, turnId: 'seven' })
  const questions = await Promise.all([first.asked, second.asked])
  expect(questions[0].options[0]).toBe('Stop')
  expect(questions[1].options[0]).toBe('Stop')
  decisions.find(item => item.id === 'seven').resolve('Allow this request')
  decisions.find(item => item.id === 'five').resolve('Stop')
  const [a, b] = await Promise.all([first.done, second.done])
  expect(a.calls).toBe(0)
  expect(b.calls).toBe(1)
  expect(a.received).toBe(undefined)
  expect(b.received).toBeDefined()
})

test('all three mod model APIs require the request-scoped approval', async () => {
  const registered = handlers()
  for (const event of ['model.complete', 'model.fork', 'model.classify']) {
    const stopped = await runModelApi(registered[event], limits(20, 100), () => 'Stop')
    expect(stopped.calls).toBe(0)
    expect(stopped.result.deny).toContain('seven-day usage is at or above 100%')
    expect(stopped.askArgs.options[0]).toBe('Stop')
    const allowed = await runModelApi(registered[event], limits(20, 100), () => 'Allow this request')
    expect(allowed.calls).toBe(1)
  }
})

test('API hook failure never redispatches the downstream call', async () => {
  const hooks = handlers()
  let calls = 0
  const next = async () => { calls += 1; throw new Error('downstream failed') }
  next.called = true
  const result = await hooks['model.complete:catch']({}, {}, next)
  expect(result.deny).toContain('guard failed')
  expect(calls).toBe(0)

  const turnStepCatch = hooks['turn.step:catch']({}, input, next)
  const returned = await turnStepCatch.next()
  expect(returned.value.usage).toBe(null)
  expect(calls).toBe(0)
})

test('Claude Code accepts a stopped turn.step without dispatching downstream', async ($, on) => {
  on('session.usage', () => ({ value: limits(100, 35) }) as never)
  on('turn.start', () => ({ turnId: input.turnId }) as never)
  let downstreamCalls = 0
  on('turn.step', async function* () {
    downstreamCalls += 1
    throw new Error('downstream model dispatch must not run')
  })
  await $.turn.start({ text: 'guard integration', turnId: input.turnId } as never)
  const stream = $.turn.step(input as never)
  let result
  while (true) {
    const part = await stream.next()
    if (part.done) { result = part.value; break }
  }
  expect(downstreamCalls).toBe(0)
  expect(result.answer).toContain('usage-credit-guard')
  expect(result.usage).toBe(null)
})
