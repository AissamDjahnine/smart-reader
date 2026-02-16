# Ariadne Shared Backend

Express + Prisma backend for collaborative Ariadne usage on a single server inside a Tailscale network.

## Features

- Email/password registration
- JWT authentication
- Shared `Book` model (`epubHash`)
- Per-user progress via `UserBook`
- Shared highlights/notes per book with author attribution
- Book sharing inbox/accept/reject via `BookShare`

## Local run

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The server listens on `0.0.0.0:4000`.
