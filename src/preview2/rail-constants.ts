/**
 * Every number of the Duo's vertical rail and of the tab bar's press-and-hold, in one place (`studio-sim-rails`).
 *
 * Native draws the rail with the system's vertical bars, so there is no S+H geometry to read: these were measured from the owner's native
 * screenshots at 2.95 px/pt (about +-1.5 pt; `build/design/studio-sim-rails/verdict.md`, `build/research/studio-sim-rails.md` 3.3).
 * A value marked `interim` is a fit or a guess that waits on a native measurement, and a later measurement changes one line here:
 *
 * - R1 (native Duo, 3 and 4 tabs at every camera corner, and turn 180): {@link COMPRESS_MARGIN}, `STATUS.bottom`, `RAIL.tabsBelowCamera`, `RAIL.headerFromEdge`.
 * - R2 is measured (`nativeref`): {@link HOLD_MS}, {@link HELD} and {@link BAR_LENS} follow it; only the quarter-turn poses stay interim.
 */

/** Rail geometry in points, measured at three native poses (folded portrait, camera top-left, camera bottom-right). */
export const RAIL = {
  /** The pill's width: a full capsule on the camera's centre line. Measured: 48.5, 48.5 and 48.5. */
  pill: 48.5,
  /** The column's centre from the camera-side window edge: pills at 24 to 72.5 (leading) and 394 to 442 (trailing, 466 wide). */
  centre: 48,
  /** The padding of the tab pill: its height is `pad * 2 + pitch * tabs` (261 pt at 5 tabs). */
  tabsPad: 5.5,
  /** Each tab's pitch in the resting pill. */
  pitch: 50,
  /** The selected tab's capsule at rest. */
  capsule: { width: 44, height: 56 },
  /** The gap between the header group, More and the tab pill. */
  gap: 12,
  /** One circle in the header group (Quick Links, Profile, an authored item) and the More circle. */
  circle: 48.5,
  /** How far the header pill hangs below the keep-clear region when the camera is at its top end (portrait: top 175 = 170 + 5). */
  headerBelowCamera: 5,
  /**
   * The tab pill's distance from the window's end at rest, when the camera is at the other end. Native probe at turn 0 (`nativeref`): bottom about 656 of 678,
   * 22 pt up; the owner's app screenshot read 25. Native evidence wins, so 22.
   */
  tabsFromEdge: 22,
  /** The header pill's top when the camera is at the bottom end (the same 24 as the compressed stack's margin). */
  headerFromEdge: 24,
  /** The tab pill's gap from the keep-clear region when the camera is at its end, uncompressed. `interim`: turn 180 is unobserved (R1). */
  tabsBelowCamera: 5,
  /** The distance of the compressed stack from the window's end when that end holds no camera (turn 270: bottom at 441.7 of 466). */
  compressedEdge: 24,
  /** Top and bottom margins of a rail with no camera (the unfolded Duo sideways): below the status bar, and above the bottom edge. */
  openTop: 32,
  /** The glyph sizes: tab, Quick Links, More, the profile disc (A4). */
  glyph: { tab: 24, quickLinks: 20, more: 20, profile: 30 },
} as const;

/**
 * The profile button's badge on the rail (A7, native `5791cbd0`): its centre is this far from the disc's centre whatever its width, 18 pt tall,
 * round for one digit and 24 x 18 for two characters such as "9+" (a minimum width of 24 with no side padding, so a font whose two characters are up to 24 wide still reads 24 x 18). The offset is of the centre, so a wider badge grows both ways.
 */
export const BADGE = { dx: 9.8, dy: -15.3, height: 18, padX: 4, wide: 24 } as const;

/**
 * The rail compresses when `header + gap + tabs` is taller than `length - keepClear - COMPRESS_MARGIN`. A fit to two native outcomes (5 tabs
 * portrait: fits; 5 tabs at a quarter turn: folds), so the threshold between 4 and 5 tabs is `interim` (R1).
 */
export const COMPRESS_MARGIN = 24;

/** The status stack (the time over the wifi mark) at the turns that draw one, centre y in points (A1). Turn 180 is `interim` (A3, R1). */
export const STATUS = {
  /** Turn 0 from the window's top: 15 pt semibold time at 92.5, the mark at 130 (no location arrow). */
  top: { time: 92.5, wifi: 130 },
  /** Turn 180 from the window's bottom (`interim`): time at 552 and the mark at 590 of a 678 pt window. */
  bottom: { time: 126, wifi: 88 },
  /** The time's type size in points. */
  timeSize: 15,
} as const;

/** The wifi mark (A2): a fixed picture, drawn the same at every turn that has one. */
export const WIFI = {
  /** The ring's outer diameter and its stroke; the three-arc glyph is about 18 pt wide from the radii below. */
  ring: 41.5, stroke: 2.5,
  /** The three arcs' radii, from the outer in, and the glyph's stroke. The arcs sit on a pivot 6 pt below the ring's centre. */
  arcs: [13, 9, 5], arcStroke: 2, pivot: 6,
  /** The dots' angles on the ring (SVG degrees, 90 is the bottom), left to right: the first two, on the left, are the bright ones. */
  dotAngles: [116, 100, 80, 64],
  /** The ring's opening at the bottom, in degrees. */
  opening: 90,
  /** The white arc from about 7 to 11 o'clock: its start and end as clock hours. */
  bright: { from: 7, to: 11 },
  /** Four dots in the opening: their size, how many, and how many are bright (they sit about 17.5 pt below the centre). */
  dot: 3.5, dots: 4, brightDots: 2,
  /** The dimmed parts are white at this opacity. */
  dim: 0.35,
} as const;

/** The More menu (A5): its width, the height `base + row * rows`, the corner radius, and the row's glyph and label offsets from its leading edge. */
export const MORE_MENU = { width: 250, base: 19, row: 42, radius: 28, glyphCentre: 40, labelStart: 64, label: 17 } as const;

/**
 * The press-and-hold on the tab bar (A8 to A10). The held pill is wider and taller per item, grows upward from a bottom 8 pt nearer the
 * window's edge (14 up, against 22 at rest), and the lens (a near-round superellipse) overhangs it.
 */
export const HELD = {
  /** The held pill's width and its tab pitch; its height is `RAIL.tabsPad * 2 + pitch * tabs`. Native (`nativeref` R2): about 76 wide and a pitch of about 60 (1.2 x 50). */
  pill: 76, pitch: 60,
  /** How far the pill's bottom moves toward the window's edge, never into the keep-clear region: the held bottom is `L - 14` against the resting `L - 22` (design verdict, round 1; the owner's held shot reads 664 of 678). */
  bottomShift: 8,
  /** The lens: width, height, corner radius, and how much it magnifies what is under it (the glyph 27 to 33 pt). */
  lens: { width: 90, height: 88, radius: 40, scale: 1.2 },
  /** The held label's type size in points. */
  label: 10,
} as const;

/**
 * How a press becomes a hold. Native (`build/evidence/studio-duo-sim/nativeref/index.md`, R2): no delay is measurable. The lens is up by the first frame after
 * touch-down and even a 0.3 s press flashes it, so a press is held at once. This replaces the Designer's interim 150 ms (A10).
 */
export const HOLD_MS = 0;
/** A press that moves this far (CSS px, screen space) before {@link HOLD_MS} is a hold at once. */
export const HOLD_MOVE_PX = 6;
/** The click the browser sends after a held release is swallowed for this long. */
export const CLICK_GUARD_MS = 120;
/** The lens on a horizontal bar (iPhone, iPad): it adds the lens only and no growth. Native: a 98 x 54 capsule becomes a lens of about 120 x 73 (1.2 wide, 1.35 tall); labels show at rest. */
export const BAR_LENS = { scaleX: 1.22, height: 73 } as const;

/** How far outside the bar a release still counts as over it (CSS px); beyond it the release commits the last tab the pointer was over, as native does. */
export const HOLD_SLOP_PX = 12;
