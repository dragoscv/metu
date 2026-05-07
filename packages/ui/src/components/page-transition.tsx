'use client';
import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps page content with a subtle fade+lift entrance keyed by pathname.
 * Use at the route segment level (e.g. inside an `(app)` layout) to give
 * navigation a polished feel without remounting the surrounding shell.
 *
 * Honors the user's reduced-motion preference automatically (framer-motion).
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname ?? 'page'}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
