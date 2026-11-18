"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { LazyMotion, MotionConfig, animate, useInView, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

import { formatNaira } from "@/lib/money";

/**
 * Motion for the whole product, in one place.
 *
 * Built on Motion (the library that used to be called Framer Motion).
 *
 * THE RULES EVERY ANIMATION HERE FOLLOWS
 * --------------------------------------
 *  1. It explains something. Content rises into place as it enters, a tile
 *     lifts when it can be pressed, a number counts up because it was just
 *     worked out. Nothing moves only to look busy.
 *  2. It is short. 0.2 to 0.6 seconds, one easing curve everywhere. A cashier
 *     opens these screens two hundred times a day; anything slower becomes the
 *     thing standing between them and their work.
 *  3. It costs nothing when it matters. Only `opacity` and `transform` are
 *     animated (the browser does those off the main thread), the engine loads
 *     after first paint, and the till itself is left alone.
 *  4. It can be switched off. Anyone whose device asks for reduced motion gets
 *     plain fades with no movement, automatically.
 */

/** One curve for everything: quick start, soft landing. */
export const EASE = [0.22, 1, 0.36, 1] as const;

const loadFeatures = () => import("./features").then((mod) => mod.default);

/** Mounted once in the root layout. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.5, ease: EASE }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/**
 * Fade and rise when scrolled into view. Plays once: content that re-animates
 * every time you scroll past it is a distraction, not a welcome.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </m.div>
  );
}

/** <Reveal> as a <section>, for pages already built out of sections. */
export function RevealSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <m.section
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {children}
    </m.section>
  );
}

const staggerParent = (gap: number, delay: number) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

const staggerChild = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/**
 * A group whose children arrive one after another. `onView` waits until the
 * group is scrolled to; without it the group plays as soon as the page opens.
 */
export function Stagger({
  children,
  className,
  gap = 0.06,
  delay = 0,
  onView = false,
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
  delay?: number;
  onView?: boolean;
}) {
  const variants = staggerParent(gap, delay);
  return onView ? (
    <m.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
    >
      {children}
    </m.div>
  ) : (
    <m.div className={className} variants={variants} initial="hidden" animate="show">
      {children}
    </m.div>
  );
}

/** A child of <Stagger>. `lift` adds the press-me hover used on tiles. */
export function StaggerItem({
  children,
  className,
  lift = false,
}: {
  children: React.ReactNode;
  className?: string;
  lift?: boolean;
}) {
  return (
    <m.div
      className={className}
      variants={staggerChild}
      whileHover={lift ? { y: -3, transition: { duration: 0.2, ease: EASE } } : undefined}
      whileTap={lift ? { scale: 0.98 } : undefined}
    >
      {children}
    </m.div>
  );
}

/** The soft arrival every back-office page makes when you navigate to it. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A figure that counts up to its value the first time it is seen.
 *
 * The real value is in the HTML the server sends, so it is correct with
 * JavaScript off, for screen readers (which get the final figure, never the
 * spinning one) and for anyone who prefers reduced motion. The count is written
 * straight to the element rather than through React state: sixty updates a
 * second on six tiles would otherwise re-render the dashboard 360 times.
 */
export function CountUp({
  value,
  kind = "number",
  className,
}: {
  value: number;
  kind?: "number" | "naira";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();

  const format = (n: number) =>
    kind === "naira" ? formatNaira(Math.round(n)) : Math.round(n).toLocaleString("en-NG");
  const final = format(value);

  // Before the first paint: start from zero so the real figure never flashes.
  useIsoLayoutEffect(() => {
    if (reduced || value === 0 || !ref.current) return;
    ref.current.textContent = format(0);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced || value === 0) {
      node.textContent = final;
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE,
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
      onComplete: () => {
        node.textContent = final;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, reduced]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden>
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}

export { m };
