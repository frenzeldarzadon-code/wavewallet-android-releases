# Complete the Loan Pool interface

## Universe member experience
- Add a dedicated **Loan Pool** destination in the Universe control center.
- Show total pool funds, available funds, allocated funds, the member’s contribution, and earned interest.
- Let eligible members contribute regular Universe coins, withdraw only unallocated funds, review open applications, and fund an application by amount.
- Rebuild **Universe Loans** around the Loan Pool rules: amount, 3/6/12-month term, required private valid-ID upload, calculated reducing-balance interest, platform fee, monthly payment, and full schedule before confirmation.
- Show each borrower’s application/funding progress, active schedule, payments, refunds/adjustments, remaining balance, normal repayment, early payoff, and cancellation where allowed.

## Super Admin experience
- Add editable Loan Pool settings for the monthly rate, allowed terms, platform fee, and owner/contributor interest split; enforce a 100% split.
- Add read-only Universe Loan oversight alongside the existing Shop Loan view, including borrower, funding, fee, schedule, repayment, earnings, adjustment, and private ID details.
- Do not add an approve/reject action for Universe Loans; contributors fund them and full funding releases them automatically.

## Safety and verification
- Use only the already-applied Loan Pool RPCs and existing private loan-ID access flow; no client-side authority or public file URLs.
- Keep Shop Loans, their current rules/screens, wallets, shops, earnings, Spending Tracker, Messenger, and Android workflow unchanged.
- Add focused UI/helper tests for calculations, validation, navigation, funding, repayment, and early-payoff presentation.
- Run relevant tests, the full app test suite, type checking, and mobile/desktop preview checks of the new screens.
- Do not publish.

## Technical details
- Create focused Loan Pool data helpers and member/admin components under the existing wallet and Super Admin patterns.
- Add the `/universe/loan-pool` route and update `/universe/loans`; add a Super Admin oversight route or clearly separated report panel using the existing `/super/loans` destination.
- Add unique route metadata to every new or changed content route.
- Update the project roadmap as each backend and interface milestone is completed.
