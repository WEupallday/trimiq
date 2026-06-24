// TrimIQ sleek "T" lettermark. Scales to any size; defaults to 32px.
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TrimIQ"
      role="img"
    >
      <defs>
        <linearGradient id="trimiqGrad" x1="3" y1="3" x2="37" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#D946EF" />
        </linearGradient>
      </defs>

      {/* rounded squircle tile */}
      <rect x="1" y="1" width="38" height="38" rx="11.5" fill="url(#trimiqGrad)" />

      {/* bold rounded T lettermark */}
      <rect x="10.5" y="11.5" width="19" height="4.6" rx="2.3" fill="white" />
      <rect x="17.7" y="11.5" width="4.6" height="17" rx="2.3" fill="white" />

      {/* subtle top sheen for depth */}
      <rect x="1" y="1" width="38" height="19" rx="11.5" fill="white" fillOpacity="0.06" />
    </svg>
  );
}
