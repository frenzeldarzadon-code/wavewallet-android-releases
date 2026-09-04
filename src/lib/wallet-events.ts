/**
 * Window event fired by wallet actions (e.g. a Universe coin transfer) so any
 * mounted balance display — like the Universe shell's balance pill — refreshes
 * without a page reload. Purely presentational; balances always come from the
 * database.
 */
export const WALLET_CHANGED_EVENT = "wavewallet:wallet-changed";

export const notifyWalletChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WALLET_CHANGED_EVENT));
};
