"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

type Props = HTMLMotionProps<"section"> & {
  delay?: number;
};

/**
 * Scroll-in motion that never hides content. The previous version
 * server-rendered every section at opacity:0 until JS hydrated and the
 * section scrolled into view: link-preview bots, some crawlers, full-page
 * screenshots, and anyone with slow JS saw large black voids (the
 * /wholesale and /catalog pages rendered mostly empty in a headless
 * capture). Now only a small translate animates; opacity stays 1, and
 * reduced-motion users get no animation at all.
 */
const MotionSection = forwardRef<HTMLElement, Props>(function MotionSection(
  { children, delay = 0, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      ref={ref}
      initial={reduce ? false : { y: 16 }}
      whileInView={reduce ? undefined : { y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      {...rest}
    >
      {children}
    </motion.section>
  );
});

export default MotionSection;
