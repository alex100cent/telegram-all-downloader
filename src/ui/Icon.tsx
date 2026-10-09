import type { SVGProps } from 'react';

const paths = {
  download: 'M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5',
  settings:
    'M10 3h4l.7 2.5 2.2 1.3 2.5-.6 2 3.5-1.8 1.9v2.8l1.8 1.9-2 3.5-2.5-.6-2.2 1.3L14 23h-4l-.7-2.5-2.2-1.3-2.5.6-2-3.5 1.8-1.9v-2.8L2.6 9.7l2-3.5 2.5.6 2.2-1.3L10 3M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  close: 'm6 6 12 12M6 18 18 6',
  external: 'M14 4h6v6m0-6L10 14M10 4H4v16h16v-6',
  check: 'm5 12 4 4L19 6',
  retry: 'M3 5v6h6M3 11a9 9 0 1 1 2.4 7.5',
  file: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8m-8 4h5',
  photo: 'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M16 7h.01',
  audio: 'M9 17V5l11-2v12M9 17a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm11-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  video: 'm10 8 6 4-6 4V8ZM3 4h18v16H3V4Z',
  voice: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6',
  sticker: 'M21 13V3H3v18h10m0 0v-8h8l-8 8ZM8 8h.01M15 8h.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  coffee: 'M4 8h12v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox={name === 'settings' ? '0 1 24 24' : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
