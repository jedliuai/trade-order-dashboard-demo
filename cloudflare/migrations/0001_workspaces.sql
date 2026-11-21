CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    login_hash TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL DEFAULT 0,
    contents TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(contents))
);
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires);
