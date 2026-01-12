# Copilot instructions for api-pwa

Purpose: quickly orient AI coding agents to the repo so they can make small, correct, and consistent changes.

- **Big picture**: This is a single-process Node.js Express API (entry: [server.js](server.js)) that exposes HTTP endpoints for user auth, projects, files, and friend management. Persistent storage is MySQL via the pooled client in [mysql.js](mysql.js). A Supabase client exists in [supabaseClient.js](supabaseClient.js) and requires `SUPABASE_SERVICE_ROLE_KEY` at runtime.

- **Run / dev workflow**: start the server locally with:

  npm run dev

  This uses `nodemon server.js`. The project uses ES modules (`type: module` in [package.json](package.json)).

- **Environment variables** (used in code):
  - `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` — mysql pool (defaults are in `mysql.js`).
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required by `supabaseClient.js` (server will throw if the service key is missing).
  - `PORT` — optional, default 3000.

- **Data flow & conventions**:
  - Endpoints are primarily defined in `server.js`. Most routes use `POST` and expect JSON bodies (rarely query params).
  - Database calls use `db.execute(sql, params)` with `?` placeholders (see many examples in `server.js`). Agents should use prepared placeholders rather than string interpolation.
  - DB column naming: snake_case (e.g. `avatar_url`, `created_at`). API responses and JS variables use camelCase (e.g. `avatarURL`, `createdAt`). When reading JSON columns, code typically calls `JSON.parse(column || "[]")` — follow the same pattern.
  - SQL results are returned as arrays: `[rows, fields]`. Use the first element for row data.
  - Stored JSON columns are treated as text in MySQL (e.g. `members`, `images`, `friends_list`) — queries often use `JSON_CONTAINS` or `JSON.parse` on read.

- **File uploads**:
  - Multer stores uploads under `uploads/avatars`. Static files are served at `/uploads` via `express.static("uploads")`.
  - Multer limits: 5 MB for avatar uploads and filters to `image/*` MIME types.

- **Error / response patterns** (follow these when adding or changing endpoints):
  - On client errors use `res.status(400).json({ message: "...", error: "ERROR_CODE" })` patterns used across the file (examples: `MISSING_FIELDS`, `USER_NOT_FOUND`).
  - On authentication or permission issues use 401 with `error: "INVALID_LOGIN"` style responses when applicable.

- **Common implementation idioms to follow** (copy these examples):
  - Prepared SQL + placeholder array:

    const [rows] = await db.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);

  - Parse stored JSON safely:

    const members = JSON.parse(project.members || "[]");

  - Build IN-list placeholders safely:

    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await db.execute(`SELECT ... WHERE id IN (${placeholders})`, ids);

- **Notable inconsistencies to be careful about**:
  - Field naming between DB and API: code sometimes uses `imageURL`, sometimes `avatar_url`/`avatarURL`. When editing handlers, preserve the existing mapping conventions (DB: `avatar_url`, API: `avatarURL`).
  - Some endpoints return a `token: "dummy-token"` (e.g. `newproject`) — do not assume real authentication exists.

- **Testing / importing**:
  - `server.js` exports `app` as default; use this when writing tests or importing the Express app.

- **Where to make changes**:
  - Route logic and data-shape decisions live in `server.js`. Small fixes that require DB changes should be coordinated with the SQL schema (not in repo).

- **Quick examples for common tasks**:
  - Add a new POST route that reads JSON body, validates required fields, writes via `db.execute`, and returns consistent error codes.
  - Update upload logic by modifying the `uploadAvatar` multer setup near the top of `server.js` and keep `uploads/avatars` as destination.

If anything here is unclear or you'd like me to expand an area (for example: expected DB schema, or examples for unit tests), tell me which part to expand and I will iterate.
