"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

type Props = HTMLMotionProps<"section"> & {
  delay?: number;
};

const MotionSection = forwardRef<HTMLElement, Props>(function MotionSection(
  { children, delay = 0, ...rest },
  ref,
) {
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: "easeOut", delay }}
      {...rest}
    >
      {children}
    </motion.section>
  );
});

export default MotionSection;
