# Arorix OS Backend Server

This is the centralized backend API for the Arorix OS platform, built with Node.js, Express, TypeScript, and PostgreSQL.

## Folder Structure

```text
src/
├── config/         # Environment variables and third-party service configuration (e.g., db.ts)
├── controllers/    # Request handlers (extracts input, calls services, sends HTTP response)
├── services/       # Core business logic (where the actual work happens)
├── models/         # Database queries and data access layer
├── routes/         # API route definitions, mapping endpoints to controllers
├── middlewares/    # Custom middlewares (authentication, error handling, validation)
├── utils/          # Reusable helper functions, formatters, and constants
├── app.ts          # Application setup (express instance, middleware registration)
└── server.ts       # Application entry point (starts the server, connects to DB)
tests/              # Unit and integration tests
database/           # Raw SQL schema initialization files
```

## Getting Started

1. Ensure you have PostgreSQL running.
2. Copy `.env.example` to `.env` and fill in your database credentials.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to start the development server.
