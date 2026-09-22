# Roadmap

## Universe Loan Pool
- [x] Settings: Universe loan interest rate, terms, interest split (50/50 default), platform fee (2% default)
- [x] Schema: loan pool accounts/ledger, universe_loans, schedule, fundings, payments
- [x] RPCs: contribute/withdraw, apply, fund (auto-release at 100%), repay, early payoff, reports
- [x] Reducing-balance interest; early payment recalculates remaining interest automatically
- [x] Excess interest refunded to borrower; lender/owner interest earnings reversed accordingly
- [x] Released coins are normal unrestricted Universe coins
- [x] UI: Loan Pool tab, Universe Loans area, Super Admin settings + oversight (no approve button)
- [x] Tests: partial/full funding, multiple + concurrent funders, payment, early payoff refund, settings snapshots
- [x] Shop Loans untouched

## Voucher auto replenishment

- [x] Safely delete the exact linked Omada group only for whole automatic-batch deletion, with durable retry/audit status
- [x] Fix ambiguous cleanup-status SQL references and regression-test automatic/manual exact-group deletion
- [x] Confirm scheduler and UI trigger paths
- [x] Add one durable event per low-stock crossing
- [x] Add atomic claim, pause, recovery, and rearm rules
- [x] Keep manual voucher generation separate
- [x] Verify stock, concurrency, retry, manual-generation, full tests, and type checking
- [x] One-time excess-stock cleanup: 78 fully unsold automatic batches deleted locally and on the controller (PHP50 20,304 -> 804; PHP20 20,452 -> 952)
