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
- **Admin / Super Admin** — never created via public signup. They are granted through the
  `bootstrap_roles` allowlist: an email is added to that table (with the target ecosystem
  for admins), and the role is applied automatically the first time that email signs up.
  Ask in chat to add a bootstrap entry for an email — no passwords are ever stored in code.

Tenant isolation is enforced by row-level security, not by route hiding: admins can only
read/write rows in their own ecosystem, users only their own profile, and super admins
have platform-wide access.
