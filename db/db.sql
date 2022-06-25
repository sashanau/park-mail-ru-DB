CREATE EXTENSION IF NOT EXISTS CITEXT;

DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS forums CASCADE;
DROP TABLE IF EXISTS threads CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS forum_users CASCADE;
DROP TABLE IF EXISTS votes CASCADE;

CREATE UNLOGGED TABLE IF NOT EXISTS users (
    nickname    CITEXT UNIQUE PRIMARY KEY,
    email       CITEXT UNIQUE NOT NULL,
    fullname    TEXT NOT NULL,
    about       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_nickname ON users using hash (nickname);

CREATE UNLOGGED TABLE IF NOT EXISTS forums (
    slug        CITEXT NOT NULL PRIMARY KEY,
    title       TEXT NOT NULL,
    posts       BIGINT DEFAULT 0 NOT NULL,
    threads     BIGINT DEFAULT 0 NOT NULL,
    "user"      CITEXT NOT NULL REFERENCES users(nickname)
);

CREATE INDEX IF NOT EXISTS forum_slug ON forums using hash (slug);

CREATE UNLOGGED TABLE IF NOT EXISTS threads (
    id          SERIAL NOT NULL PRIMARY KEY,
    created     TIMESTAMPTZ,
    slug        CITEXT,
    message     TEXT NOT NULL,
    title       TEXT NOT NULL,
    votes       INTEGER DEFAULT 0 NOT NULL,
    author      CITEXT NOT NULL REFERENCES users(nickname),
    forum       CITEXT NOT NULL REFERENCES forums(slug)
);

CREATE INDEX IF NOT EXISTS thread_slug ON threads using hash (slug);
CREATE INDEX IF NOT EXISTS thread_forum ON threads using hash (forum);
CREATE INDEX IF NOT EXISTS thread_forum_created ON threads (forum, created);

CREATE UNLOGGED TABLE IF NOT EXISTS posts (
    id          SERIAL NOT NULL PRIMARY KEY,
    created     TIMESTAMPTZ NOT NULL,
    isEdited    BOOLEAN DEFAULT FALSE NOT NULL,
    message     TEXT NOT NULL,
    author      CITEXT NOT NULL REFERENCES users(nickname),
    thread      BIGINT NOT NULL REFERENCES threads(id),
    forum       CITEXT NOT NULL REFERENCES forums(slug),
    parent      BIGINT NOT NULL,
    path        int[]  DEFAULT ARRAY[] :: INT[]
);

-- CREATE INDEX IF NOT EXISTS posts_select_thread_path ON posts (thread, path);
-- CREATE INDEX IF NOT EXISTS posts_select_thread_parent ON posts (thread, parent);
-- CREATE INDEX IF NOT EXISTS posts_select_thread_parent_path ON posts (thread, parent, (path[1]));
-- CREATE INDEX IF NOT EXISTS posts_select_path_path_id ON posts ((path[1]), path, id);
-- CREATE INDEX IF NOT EXISTS posts_select_path_id ON posts (path, id);
CREATE INDEX IF NOT EXISTS post_thread_path ON posts (thread, path);
CREATE INDEX IF NOT EXISTS post_thread ON posts (thread);
CREATE INDEX IF NOT EXISTS post_path_complex ON posts ((path[1]), path);

CREATE UNLOGGED TABLE IF NOT EXISTS votes (
    voice         SMALLINT NOT NULL,
    UNIQUE (thread_id, nickname),
    thread_id     BIGINT NOT NULL REFERENCES threads(id),
    nickname        CITEXT NOT NULL REFERENCES users(nickname)
);

CREATE INDEX IF NOT EXISTS search_user_vote ON Votes (nickname, thread_id, voice);

CREATE UNLOGGED TABLE IF NOT EXISTS forum_users (
  nickname citext COLLATE "ucs_basic" NOT NULL REFERENCES users (nickname),
  fullname text NOT NULL,
  about text,
  email citext NOT NULL,
  forum citext NOT NULL REFERENCES forums (slug),
  CONSTRAINT forum_users_key UNIQUE (nickname, forum)
);

CREATE INDEX IF NOT EXISTS forum_users_forum ON forum_users using hash (forum);

CREATE OR REPLACE FUNCTION update_forum_user() RETURNS TRIGGER AS $$
DECLARE
    nickname citext;
    fullname text;
    about    text;
    email    citext;
  BEGIN
    SELECT u.nickname, u.fullname, u.about, u.email FROM users u WHERE u.nickname = NEW.author
    INTO nickname, fullname, about, email;

    INSERT INTO forum_users (nickname, fullname, about, email, forum)
    VALUES (nickname, fullname, about, email, NEW.forum)
    ON CONFLICT do nothing;

    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_forum_users_on_post AFTER INSERT ON posts FOR EACH ROW EXECUTE PROCEDURE update_forum_user();
CREATE TRIGGER update_forum_users_on_thread AFTER INSERT ON threads FOR EACH ROW EXECUTE PROCEDURE update_forum_user();

CREATE OR REPLACE FUNCTION update_post_path() RETURNS TRIGGER AS $$
BEGIN
    new.path = (SELECT path FROM posts WHERE id = new.parent) || new.id;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_path BEFORE INSERT ON posts FOR EACH ROW EXECUTE PROCEDURE update_post_path();

CREATE OR REPLACE FUNCTION update_post_count() RETURNS TRIGGER AS $$
BEGIN
    UPDATE forums
    SET posts = forums.posts + 1
    WHERE slug = new.forum;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_posts_count_trigger AFTER INSERT ON posts FOR EACH ROW EXECUTE PROCEDURE update_post_count();

CREATE OR REPLACE FUNCTION update_thread_count() RETURNS TRIGGER AS $$
BEGIN
    UPDATE forums
    SET threads = forums.threads + 1
    WHERE slug = new.forum;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_thread_count_trigger AFTER INSERT ON threads FOR EACH ROW EXECUTE PROCEDURE update_thread_count();

CREATE OR REPLACE FUNCTION update_vote_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        UPDATE threads
        SET Votes = Votes - old.Voice + new.Voice
        WHERE id = new.thread_id;
        RETURN new;
    ELSE
        UPDATE threads
        SET Votes = Votes + new.Voice
        WHERE id = new.thread_id;
        RETURN new;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vote_count_trigger AFTER UPDATE OR INSERT ON votes FOR EACH ROW EXECUTE PROCEDURE update_vote_count();

VACUUM ANALYSE;