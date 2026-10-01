# Kas Komunitas

A shared community cashbook: record money in and money out, see the
running balance, and browse the ledger month by month. Built on Homeroom.

## Features

- **Balance header** — the all-time balance in rupiah, plus the income
  and expense totals for the selected period.
- **Month filter** — horizontally scrollable chips (current month plus
  the five before it, or "Semua" for everything). A specific month is
  deep-linkable via `/?month=YYYY-MM`.
- **Ledger list** — every entry with its note, date and signed amount,
  attributed to the member who added it. Income is green, expenses red.
- **Add entry** — a bottom sheet opened from the floating + button:
  pick income or expense, enter the amount, an optional note and the
  date (defaults to today).
- **Dark mode** — follows the viewer's Light/Dark/System setting in the
  platform shell.

## How it works

- **Sign-in** — the server verifies the platform-issued user token
  (an RS256 JWT) on every request, so the app always knows who is using
  it. No accounts to build.
- **Database** — the app's own Postgres database holds a single shared
  `entries` table (`type`, `amount` as integer rupiah, `note`,
  `occurred_on`). Schema is applied idempotently on boot; staging seeds
  a few obviously fake demo rows.
- **API** — `GET /api/entries?month=YYYY-MM` returns the balance, the
  period totals and the entries; `POST /api/entries` writes one entry.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation with either Kubernetes/Paketo or standalone Docker.