const KHMER_SCRIPT_RE = /[\u1780-\u17FF\u19E0-\u19FF]/u

type TextProps = {
  lang?: 'km'
  className?: string
}

export function containsKhmerScript(value: unknown): boolean {
  return KHMER_SCRIPT_RE.test(String(value || ''))
}

export function withKhmerTextClass(value: unknown, className = ''): string {
  return containsKhmerScript(value)
    ? [className, 'khmer-text'].filter(Boolean).join(' ')
    : className
}

export function getKhmerTextProps(value: unknown, className = ''): TextProps {
  if (!containsKhmerScript(value)) {
    return className ? { className } : {}
  }
  return {
    lang: 'km',
    className: [className, 'khmer-text'].filter(Boolean).join(' '),
  }
}
