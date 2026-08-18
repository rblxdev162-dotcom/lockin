/** Hand-rolled 24px stroke icons — no icon dependency, no network fetch. */
import type { SVGProps } from 'react';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export type IconName =
  | 'home'
  | 'list'
  | 'exam'
  | 'timer'
  | 'activity'
  | 'settings'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'check'
  | 'trash'
  | 'edit'
  | 'search'
  | 'shield'
  | 'sun'
  | 'moon'
  | 'alert'
  | 'close'
  | 'play'
  | 'pause'
  | 'stop'
  | 'bolt'
  | 'canvas'
  | 'link'
  | 'unlink'
  | 'external'
  | 'refresh'
  | 'camera'
  | 'edgenuity'
  | 'volume'
  | 'badge'
  | 'calendar'
  | 'arrowRight';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  exam: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </>
  ),
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8 13h3M8 16.5h6" />
    </>
  ),
  arrowRight: <path d="M4 12h15m-6-6 6 6-6 6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  shield: <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  alert: <path d="M12 4 2.5 20h19zM12 10v4M12 17.2v.1" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  // A generic "learning platform" mark — deliberately not the Canvas logo.
  canvas: (
    <>
      <rect x="3.5" y="4.5" width="17" height="13" rx="2.5" />
      <path d="M8 21h8M12 17.5V21M8 9h5M8 12.5h8" />
    </>
  ),
  link: <path d="M10 13.5a4 4 0 0 0 5.7.2l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10.5a4 4 0 0 0-5.7-.2l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" />,
  unlink: (
    <>
      <path d="M9.5 14.5 7 17a4 4 0 0 1-5.7-5.7L4 8.6M14.5 9.5 17 7a4 4 0 0 1 5.7 5.7L20 15.4" />
      <path d="M3 3l18 18" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" />,
  camera: (
    <>
      <path d="M3.5 8.5h3l1.5-2.5h8L17.5 8.5h3V19h-17z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="M16 9.5a4 4 0 0 1 0 5" />
    </>
  ),
  // Enhanced Proof: a seal, used on the trust badge.
  badge: (
    <>
      <path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.8 2.6.8 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15l.8-2.6-.8-2.6 2.3-1.4 1-2.5 2.7.2z" />
      <path d="M9.5 12.2l1.8 1.8 3.4-3.6" strokeWidth={2.2} />
    </>
  ),
  // A screen with a progress bar — Edgenuity proof is a photo of a screen.
  edgenuity: (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
      <path d="M6.5 13.5h7" strokeWidth={2.6} />
      <path d="M6.5 13.5h11" opacity={0.35} />
      <path d="M8.5 20.5h7" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
