import { forwardRef } from 'react'
import type { LucideProps } from 'lucide-react'

const FACEBOOK_MARK_PATH = 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z'

const INSTAGRAM_MARK_PATH = 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077'

type BrandMarkProps = LucideProps & { path: string; mark: string }

const BrandMark = forwardRef<SVGSVGElement, BrandMarkProps>(function BrandMark(
  { path, mark, color = 'currentColor', size = 24, className, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      aria-hidden="true"
      data-brand-mark={mark}
      {...rest}
    >
      <path d={path} />
    </svg>
  )
})

export const FacebookIcon = forwardRef<SVGSVGElement, LucideProps>(function FacebookIcon(props, ref) {
  return <BrandMark ref={ref} path={FACEBOOK_MARK_PATH} mark="facebook" {...props} />
})

export const InstagramIcon = forwardRef<SVGSVGElement, LucideProps>(function InstagramIcon(props, ref) {
  return <BrandMark ref={ref} path={INSTAGRAM_MARK_PATH} mark="instagram" {...props} />
})

/**
 * Stylized Facebook Messenger glyph -- the rounded speech-bubble-with-tail
 * shape and internal "lightning bolt" chevron that reads as Messenger at a
 * glance, drawn in this app's own line-icon style (24x24, stroke=currentColor)
 * rather than lucide's generic MessageSquare, which was previously used as a
 * stand-in and doesn't read as Messenger to anyone who recognizes the app.
 *
 * Built as a LucideProps-typed forwardRef component so it's a drop-in
 * replacement anywhere a `LucideIcon` is expected (icon maps typed
 * `Record<string, LucideIcon>`, `<Icon className="..." />` call sites, etc.).
 */
export const MessengerIcon = forwardRef<SVGSVGElement, LucideProps>(function MessengerIcon(
  { color = 'currentColor', size = 24, strokeWidth = 2, className, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 3C7.03 3 3 6.69 3 11.25c0 2.7 1.42 5.1 3.62 6.62.19.13.3.35.3.58l.06 2.02c.02.66.7 1.09 1.3.8l2.26-1.1c.19-.09.4-.11.61-.06.6.14 1.22.22 1.85.22 4.97 0 9-3.69 9-8.25S16.97 3 12 3Z" />
      <path
        d="m8 13.3 3.4-3.7a.6.6 0 0 1 .86-.03L15 12.1l3-3.3-3.55 5.8-2.6-2.53a.6.6 0 0 0-.85.03L8 15.4z"
        fill={color}
        stroke="none"
      />
    </svg>
  )
})
