"use client";

/**
 * Topographic wave pattern from the Fanzia brand style imagery.
 * Pure SVG so it scales + tints with currentColor.
 */
export default function WavePattern({
  className,
  stroke = "#f13737",
  opacity = 0.4,
  lines = 22,
}: {
  className?: string;
  stroke?: string;
  opacity?: number;
  lines?: number;
}) {
  const paths = Array.from({ length: lines }).map((_, i) => {
    const y = 20 + i * (460 / lines);
    const amp = 8 + (i % 5) * 4;
    const freq = 0.012 + (i % 3) * 0.003;
    let d = `M0,${y}`;
    for (let x = 0; x <= 1000; x += 10) {
      d += ` L${x},${y + Math.sin(x * freq + i * 0.6) * amp}`;
    }
    return d;
  });

  return (
    <svg
      aria-hidden
      viewBox="0 0 1000 500"
      preserveAspectRatio="none"
      className={className}
      style={{ opacity }}
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={0.8}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
