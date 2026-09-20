/**
 * The prototype's inline SVGs as components.
 *
 * LISTLY-DESIGN.md §5: "simple line icons (2px stroke, rounded caps)". Every
 * path below is copied from listly-prototype.html so the real build is the
 * same drawing, not a lookalike from an icon package. They are inline rather
 * than a sprite or a dependency because there are twelve of them and they
 * never change.
 */

type Props = { size?: number; className?: string }

function Line({ size = 24, width = 2, className, children }: Props & { width?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

export const Chevron = ({ size = 22 }: Props) => (
  <Line size={size} width={2.4} className="chev">
    <path d="M9 5l7 7-7 7" />
  </Line>
)

/** The white tick inside a filled checkbox. Deliberately hard-coded white:
 *  it only ever sits on --sage. */
export const Tick = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)

/** The same tick in the current colour, for the Finish shop button. */
export const TickSmall = () => (
  <Line size={18} width={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Line>
)

export const Plus = () => (
  <Line size={20} width={2.6}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Line>
)

export const Close = () => (
  <Line size={20} width={2.4}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Line>
)

export const Warn = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 2.5 20h19L12 3z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5h.01" />
  </svg>
)

export const Grip = () => (
  <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="10" cy="4" r="1.6" />
    <circle cx="4" cy="10" r="1.6" />
    <circle cx="10" cy="10" r="1.6" />
    <circle cx="4" cy="16" r="1.6" />
    <circle cx="10" cy="16" r="1.6" />
  </svg>
)

export const Basket = () => (
  <Line>
    <path d="M4 9h16l-1.6 10.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 9z" />
    <path d="M8.5 9 11 3.5" />
    <path d="M15.5 9 13 3.5" />
    <path d="M9.5 13.5v3.5" />
    <path d="M14.5 13.5v3.5" />
  </Line>
)

export const House = () => (
  <Line>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Line>
)

export const Me = () => (
  <Line>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </Line>
)

export const Bell = () => (
  <Line size={22}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Line>
)

export const Star = () => (
  <Line size={22}>
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
  </Line>
)

export const StarFilled = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
  </svg>
)

export const Trash = () => (
  <Line size={20}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l1 13h9l1-13" />
  </Line>
)

export const Sliders = () => (
  <Line size={18}>
    <path d="M4 7h10" />
    <path d="M18 7h2" />
    <circle cx="16" cy="7" r="2" />
    <path d="M4 17h2" />
    <path d="M10 17h10" />
    <circle cx="8" cy="17" r="2" />
  </Line>
)
