CREATE TABLE simulation_workspaces (
 id TEXT PRIMARY KEY NOT NULL,
 version INTEGER NOT NULL,
 data TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE simulation_file_chunks (
 workspace_id TEXT NOT NULL,
 file_id TEXT NOT NULL,
 chunk_index INTEGER NOT NULL,
 body TEXT NOT NULL,
 PRIMARY KEY(workspace_id,file_id,chunk_index)
);
