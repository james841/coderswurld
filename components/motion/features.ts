/**
 * The animation engine, split into its own file so it downloads AFTER the page
 * is on screen instead of with it (see MotionProvider). `domAnimation` is the
 * small feature set: fades, slides, hover, tap, scroll-into-view. The larger
 * `domMax` (drag, shared-layout) is deliberately not used anywhere.
 */
export { domAnimation as default } from "motion/react";
