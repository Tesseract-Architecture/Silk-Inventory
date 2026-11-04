import { useComputedColorScheme } from '@mantine/core';

// Versiones pre-escaladas (1x/2x/3x) para que el logo se vea nítido: achicarlo en el navegador lo deja borroso.
const SIZES = { 40: [40, 80, 120], 64: [64, 128, 192] } as const;

export default function SilkLogo({ height }: { height: 40 | 64 }) {
  const dark = useComputedColorScheme('light') === 'dark';
  const base = dark ? '/silk-logo-dark' : '/silk-logo';
  const [x1, x2, x3] = SIZES[height];
  return (
    <img
      src={`${base}-${x1}.png`}
      srcSet={`${base}-${x1}.png 1x, ${base}-${x2}.png 2x, ${base}-${x3}.png 3x`}
      alt="Silk Technologies"
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
    />
  );
}
