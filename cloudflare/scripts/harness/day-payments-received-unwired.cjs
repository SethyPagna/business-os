// telegram.ts imports lib/dayPaymentsReceived.ts (the Received section) and lib/d1ReadCoalescer.ts (batched reads). A test that loads the real telegram.ts
// with a hand-written module map and never renders that section maps it to this stub; one that does render it
// loads the real module (see test-telegram-summary-sections-pure.cjs) and gets a loud failure here if it forgets.
module.exports = {
  coalesceD1Reads: (env) => env,
  dayPaymentsReceived: async () => { throw new Error('dayPaymentsReceived is not wired in this test: load lib/dayPaymentsReceived.ts') },
}
