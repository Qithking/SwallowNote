/**
 * Toast — thin re-export wrapper around sonner.
 *
 * Keeping this indirection means we can swap implementations
 * (e.g. host-provided toast API) without touching every call
 * site. Sonner is the only runtime dependency; when the host
 * doesn't provide sonner the same `toast` import works as a
 * plain console.log fallback.
 */
export { toast } from 'sonner'
