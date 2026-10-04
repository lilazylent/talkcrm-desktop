import { useId } from 'react';

// TalkCRM mark: a speech bubble carrying a voice wave. Geometry mirrors assets/logo.svg and scripts/createIcon.py.
const wave = [[16, 8, '#5b5cf0'], [23, 15, '#6a52f5'], [30, 21, '#7c4dff'], [37, 13, '#4a8ff0'], [44, 7, '#15b8d8']] as const;
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId();
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b5cf0"/><stop offset=".52" stopColor="#7c4dff"/><stop offset="1" stopColor="#15c5e6"/></linearGradient></defs>
    <rect width="64" height="64" rx="15" fill={`url(#${id})`}/>
    <rect x="11" y="13" width="42" height="30" rx="10" fill="#fff"/><path d="M17 38 15.5 51 29 42z" fill="#fff"/>
    {wave.map(([x, h, color]) => <rect key={x} x={x} y={28 - h / 2} width="4" height={h} rx="2" fill={color}/>)}
  </svg>;
}
