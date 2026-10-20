/**
 * Shared "soft diagonal" language for large media blocks (login and home hero):
 * one clean slanted edge with rounded corners, never a wave or blob. The paths use
 * objectBoundingBox units so they scale with whatever box they clip; the CSS that
 * applies them lives next to the classes in index.css (.auth-media, .hero-media).
 * Purely decorative: if clip-path is unsupported the block keeps its normal shape.
 */
export function DiagonalShapeDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      {/* Bottom edge rising to the right (login on mobile). */}
      <clipPath id="shape-diagonal-bottom" clipPathUnits="objectBoundingBox">
        <path d="M0,0 H1 V0.9 Q1,0.925 0.95,0.93 L0.05,0.995 Q0,1 0,0.95 Z" />
      </clipPath>
      {/* Right edge leaning like a motion line (login from md). */}
      <clipPath id="shape-diagonal-side" clipPathUnits="objectBoundingBox">
        <path d="M0,0 H0.975 Q1,0 0.995,0.04 L0.885,0.96 Q0.88,1 0.84,1 H0 Z" />
      </clipPath>
      {/* Gentler bottom edge for the hero card: keeps the photo tall and clear of the dots and badge. */}
      <clipPath id="shape-diagonal-hero" clipPathUnits="objectBoundingBox">
        <path d="M0,0 H1 V0.925 Q1,0.945 0.955,0.95 L0.045,0.997 Q0,1 0,0.955 Z" />
      </clipPath>
      {/* Desktop hero panel: the LEFT edge is the diagonal. It starts about a quarter of the way in at the top and
          opens out to the box's left edge at the bottom, so the photo reaches toward the centre of the hero. The
          bottom edge keeps a softer rise (about 10-15px) so the panel sits on the next section; its lowest point
          stays just above the box bottom, so the rounded bottom-left corner is never clipped by the hero. */}
      <clipPath id="shape-diagonal-hero-wide" clipPathUnits="objectBoundingBox">
        <path d="M0.285,0 H1 V0.972 L0.05,0.99 Q0,0.995 0,0.962 L0.25,0.03 Q0.262,0 0.285,0 Z" />
      </clipPath>
    </svg>
  );
}
