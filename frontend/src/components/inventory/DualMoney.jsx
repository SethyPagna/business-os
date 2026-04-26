// ── DualMoney ────────────────────────────────────────────────────────────────
// Displays a monetary amount in both USD and KHR inline.

export default
function DualMoney({ usd, khr, fmtUSD, fmtKHR }) {
  return (
    <div className="text-right">
      <div className="font-medium text-xs text-gray-800 dark:text-gray-200">{fmtUSD(usd)}</div>
      {khr > 0 && <div className="text-[10px] text-gray-400">{fmtKHR(khr)}</div>}
    </div>
  )
}

