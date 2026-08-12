# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## WaveWallet — accounts & roles (Stage 1)

Authentication is real email/password. Roles are **never** chosen by the client:

- **Customer** — created only through a tenant link `/join/{ecosystem-slug}`. A database
  trigger assigns the `customer` role and the ecosystem behind that slug.
- **Reseller** — an existing customer promoted by their Admin (`promote_to_reseller` RPC).
  The account row, profile, wallets and history are preserved; the change is audit-logged.
- **Admin / Super Admin** — never created via public signup. A Super Admin creates the
  ecosystem and invites the admin email from **Super Admin → Ecosystems & Admins**
  (`invite_admin` RPC). The role and ecosystem are applied automatically the first time that
  email signs up; invitations expire and can be revoked. No passwords are ever stored in code.
  Ask in chat to seed the very first Super Admin invitation.

Subscriptions: each ecosystem carries `subscription_state`
(`pending → awaiting_approval → active | rejected | expired | suspended`), a plan/price, a
period end and a grace period. Admins submit a payment reference
(`submit_subscription_payment`); Super Admins approve or reject (`review_subscription`).
An admin whose ecosystem is outside `subscription_ok()` is routed to the subscription screen
and blocked at the database layer, not just in the UI.

Credits and points use append-only ledgers (`credit_ledger`, `points_ledger`) with
account balances maintained by triggers — the ledger, not the balance, is the source of truth.

Tenant isolation is enforced by row-level security, not by route hiding: admins can only
read/write rows in their own ecosystem, users only their own profile, and super admins
have platform-wide access. Database functions are locked down: only self-authorizing RPCs
are callable, and the sole anonymous one is the signup-link shop lookup.

