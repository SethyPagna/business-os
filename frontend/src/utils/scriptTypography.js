const KHMER_SCRIPT_RE = /[\u1780-\u17FF\u19E0-\u19FF]/u

export function containsKhmerScript(value) {
  return KHMER_SCRIPT_RE.test(String(value || ''))
}

export function withKhmerTextClass(value, className = '') {
  return containsKhmerScript(value)
    ? [className, 'khmer-text'].filter(Boolean).join(' ')
    : className
}

export function getKhmerTextProps(value, className = '') {
  if (!containsKhmerScript(value)) {
    return className ? { className } : {}
  }
  return {
    lang: 'km',
    className: [className, 'khmer-text'].filter(Boolean).join(' '),
  }
}
