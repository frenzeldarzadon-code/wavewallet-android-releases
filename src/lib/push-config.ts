/**
 * Public half of the platform's Web Push (VAPID) key pair.
 *
 * This value is safe to ship to browsers — it only lets a phone recognise that
 * a push came from ONE WAVE. The private half lives in the server secrets and
 * never leaves the sender.
 */
export const VAPID_PUBLIC_KEY =
  "BNwSdlpKbpPwr9DpM-vpGnaMcOyqLeYlE8k2L2pethKSIrQB46wNOQRtYdSntyRdM7rzcZdGJ0hO2MjBkwyMp-o";
