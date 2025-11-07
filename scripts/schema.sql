-- Agent Builder Ultra default schema stub
-- Extend with your own tables as needed.

CREATE TABLE IF NOT EXISTS vector_memory (
    id UUID PRIMARY KEY,
    task_id TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_entries (
    id UUID PRIMARY KEY,
    task_id TEXT NOT NULL,
    rating INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
