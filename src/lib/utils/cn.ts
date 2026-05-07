import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with proper conflict resolution
 * Standard utility for shadcn-svelte components
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
