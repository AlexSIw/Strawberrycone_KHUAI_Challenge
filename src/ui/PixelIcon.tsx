import { ICONS, iconPath, type IconName } from './pixelIcons';

const PATHS = Object.fromEntries(
  (Object.keys(ICONS) as IconName[]).map((name) => [name, { full: iconPath(ICONS[name], '#'), half: iconPath(ICONS[name], '+') }]),
) as Record<IconName, { full: string; half: string }>;

/** One 8 x 8 pixel icon in the current text color. scale = screen px per art pixel (2 matches the map). */
export function PixelIcon({ name, scale = 2, label, className = '' }: { name: IconName; scale?: number; label?: string; className?: string }) {
  const s = Math.max(1, Math.round(scale));
  const { full, half } = PATHS[name];
  return (
    <svg
      className={`pxi ${className}`.trim()}
      viewBox="0 0 8 8"
      width={8 * s}
      height={8 * s}
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {half && <path d={half} fillOpacity={0.5} />}
      <path d={full} />
    </svg>
  );
}
