'use strict';

const express = require('express');
const body = require('body-parser');
// const cookie = require('cookie-parser');
// const morgan = require('morgan');
const app = express();

// app.use(morgan('dev'));
app.use(body.json());
// app.use(cookie());

// const swaggerUi = require('swagger-ui-express');
// const YAML = require('yamljs');
// const swaggerDocument = YAML.load('./server/swagger.yaml');

const pgp = require("pg-promise")(/*options*/);
const db = pgp("postgres://api:password@localhost:5432/api");
db.connect();

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const port = 5000;


// FORUM
app.post('/api/forum/create', async (req, res) => {
    const user = await db.query('SELECT * FROM users WHERE nickname = $1',
        [req.body.user]);
    if (user.length === 0) {
        res.status(404).send({message: `Can't find user with nickname ${req.body.user}\n`});
        return;
    }

    const getForm = await db.query('SELECT slug, title, "user" FROM forums WHERE slug = $1  AND "user" = $3;',
        [req.body.slug, req.body.title, req.body.user]);
    if (getForm.length !== 0) {
        res.status(409).send(getForm[0]);
        return;
    }

    const insert = await db.query('INSERT INTO forums (slug, title, posts, threads, "user") VALUES ($1, $2, 0, 0, $3) RETURNING slug, title;',
        [req.body.slug, req.body.title, user[0].nickname]);
    if (insert) {
        res.status(201).send({...insert[0], user: user[0].nickname});
    }
});

app.get('/api/forum/:slug/details', async (req, res) => {
    const slug = req.params.slug;

    const getForm = await db.query('SELECT * FROM forums WHERE slug = $1;',
        [slug]);

    if (getForm.length === 0) {
        res.status(404).send({message: `Can't find forum with slug ${slug}\n`});
        return;
    }
    getForm.forEach((elem) => {
        elem.threads = Number(elem.threads);
        elem.posts = Number(elem.posts);
    })

    res.status(200).send(getForm[0]);
});

app.post('/api/forum/:slug/create', async (req, res) => {
    const slug = req.params.slug;

    const user = await db.query('SELECT * FROM users WHERE nickname = $1',
        [req.body.author]);
    if (user.length === 0) {
        res.status(404).send({message: `Can't find user with nickname ${req.body.author}\n`});
        return;
    }

    const getForm = await db.query('SELECT * FROM forums WHERE slug = $1;',
        [slug]);
    if (getForm.length === 0) {
        res.status(404).send({message: `Can't find forum with slug ${slug}\n`});
        return;
    }

    const getThread = await db.query('SELECT * FROM threads WHERE slug = $1;',
        [req.body.slug]);
    if (getThread.length !== 0) {
        res.status(409).send(getThread[0]);
        return;
    }
    const resuer = await db.query('INSERT INTO threads (title, author, forum, message, votes, slug, created) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;',
        [req.body.title, req.body.author, getForm[0].slug, req.body.message, 0, req.body.slug, req.body.created]);
    res.status(201).send({...resuer[0]});
});

app.get('/api/forum/:slug/users', async (req, res) => {
    const slug = req.params.slug;

    const users = await db.query(`SELECT nickname, fullname, about, email FROM forum_users WHERE forum = $1
        ${(req.query.since !== undefined) ? `${(req.query.desc === 'false' || req.query.desc === undefined) ? `AND nickname > '${req.query.since}'` : `AND nickname < '${req.query.since}'`}` : ''}
                                  ORDER BY nickname ${(req.query.desc === 'false' || req.query.desc === undefined) ? '' : 'DESC'}
                                      LIMIT $2`, [slug, req.query.limit]);
    if (users.length === 0) {
        const getForm = await db.query('SELECT * FROM forums WHERE slug = $1;',
            [slug]);
        if (getForm.length === 0) {
            res.status(404).send({message: `Can't find forum with slug ${slug}\n`});
            return;
        } else {
            res.status(200).send([]);
            return;
        }
    }
    res.status(200).send(users);
});

app.get('/api/forum/:slug/threads', async (req, res) => {
    const forum = req.params.slug;

    const getThreads = await db.query(`SELECT *
                                       FROM threads
                                       WHERE forum = '${forum}' ${(req.query.since) ? ((req.query.desc === 'true') ? `AND created <= '${req.query.since}'` : `AND created >= '${req.query.since}'`) : ''}
                                       ORDER BY created ${(req.query.desc === 'true') ? 'DESC' : ''} ${(req.query.limit) ? `LIMIT ${req.query.limit}::TEXT::INTEGER` : ''};`
    );
    if (getThreads.length === 0) {
        const getForm = await db.query('SELECT * FROM threads WHERE forum = $1;',
            [forum]);
        if (getForm.length === 0) {
            res.status(404).send({message: `Can't find forums with forum ${forum}\n`});
            return;
        } else {
            res.status(200).send([]);
            return;
        }
    }
    res.status(200).send(getThreads);
});

app.post('/api/service/clear', async (req, res) => {
    await db.query('TRUNCATE forum_users, votes, posts, threads, forums, users');
    res.status(200).send();
});

app.get('/api/service/status', async (req, res) => {
    const count = await db.query(`SELECT COUNT(*)                     as forum,
                                         SUM(posts)                   as post,
                                         SUM(threads)                 as thread,
                                         (SELECT COUNT(*) FROM users) as "user"
                                  FROM forums`);
    if (!count[0].post) {
        count[0].post = 0;
    }
    if (!count[0].thread) {
        count[0].thread = 0;
    }
    res.status(200).send({
        forum: Number(count[0].forum),
        post: Number(count[0].post),
        thread: Number(count[0].thread),
        user: Number(count[0].user)
    });
});

// POST

app.post('/api/thread/:slug_or_id/create', async (req, res) => {
    try {
        const slugOrId = req.params.slug_or_id;
        let have;
        if (!isNaN(slugOrId)) {
            have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
            if (have.length === 0) {
                res.status(404).send({message: `Can't find thread with id ${slugOrId}\n`});
                return;
            }
        } else {
            have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
            if (have.length === 0) {
                res.status(404).send({message: `Can't find thread with slug ${slugOrId}\n`});
                return;
            }
        }

        const posts = req.body;
        if (posts.length === 0) {
            res.status(201).send([]);
            return;
        }

        let result = [];
        const nowDate = new Date().toUTCString();
        let i = 0;
        const tmp = await db.query(`SELECT *
                                    FROM users
                                    WHERE nickname = $1`, [posts[0].author]);
        if (tmp.length === 0) {
            res.status(404).send({message: `Can't find users with nickname ${posts[0].author}\n`});
            return;
        }
        for (let post of posts) {
            if (post.parent) {
                const parent = await db.query(`SELECT *
                                               FROM posts
                                               WHERE id = $1`, [post.parent]);
                if (parent.length === 0 || Number(parent[0].thread) !== Number(have[0].id)) {
                    res.status(409).send({message: `Can't find posts with id ${post.parent}\n`});
                    return;
                }
            }
            if (i === posts.length - 1) {
                result += `(${(post.parent) ? post.parent : 0}, '${post.author}', '${post.message}', false, '${have[0].forum}', ${have[0].id}, '${nowDate}')`;
            } else {
                result += `(${(post.parent) ? post.parent : 0}, '${post.author}', '${post.message}', false, '${have[0].forum}', ${have[0].id}, '${nowDate}'), `;
            }
            i++;
        }
        const resultQuery = await db.query(`INSERT INTO posts (parent, author, message, isedited, forum, thread, created)
                                            VALUES ${result} RETURNING *;`);
        resultQuery.forEach((post) => {
            post.thread = Number(post.thread);
            post.parent = Number(post.parent);
        })
        res.status(201).send(resultQuery);
    } catch (error) {
        console.log(error);
        res.status(201).send({});
    }
});

app.get('/api/thread/:slug_or_id/details', async (req, res) => {
    const slugOrId = req.params.slug_or_id;
    let have;
    if (!isNaN(slugOrId)) {
        have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with id ${slugOrId}\n`});
            return;
        }
        res.status(200).send(have[0]);
    } else {
        have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with slug ${slugOrId}\n`});
            return;
        }
        res.status(200).send(have[0]);
    }
});

app.post('/api/thread/:slug_or_id/details', async (req, res) => {
    const slugOrId = req.params.slug_or_id;
    let message = req.body.message;
    let title = req.body.title;
    let have;
    if (!isNaN(slugOrId)) {
        have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find posts with id ${slugOrId}\n`});
            return;
        }
        if (message === undefined) {
            message = have[0].message;
        }
        if (title === undefined) {
            title = have[0].title;
        }
        const result = await db.query('UPDATE threads SET title = $1, message = $2 WHERE id = $3 RETURNING *', [title, message, slugOrId]);
        res.status(200).send(result[0]);
    } else {
        have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find posts with slug ${slugOrId}\n`});
            return;
        }
        if (message === undefined) {
            message = have[0].message;
        }
        if (title === undefined) {
            title = have[0].title;
        }
        const result = await db.query('UPDATE threads SET title = $1, message = $2 WHERE slug = $3 RETURNING *', [title, message, slugOrId]);
        res.status(200).send(result[0]);
    }
});

app.get('/api/thread/:slug_or_id/posts', async (req, res) => {
    const slugOrId = req.params.slug_or_id;
    let have;
    if (!isNaN(slugOrId)) {
        have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with id ${slugOrId}\n`});
            return;
        }
    } else {
        have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with slug ${slugOrId}\n`});
            return;
        }
    }

    if (req.query.sort === 'tree') {
        const result = await db.query(`SELECT * 
                                        FROM posts 
                                        WHERE thread = ${have[0].id} ${(req.query.since !== undefined) ?
            (req.query.desc === 'false' || req.query.desc === undefined) ?
                `AND path > (SELECT path FROM posts WHERE id = ${req.query.since})`
                : `AND path < (SELECT path FROM posts WHERE id = ${req.query.since})`
            : ''}
                                        ORDER BY path ${(req.query.desc === 'false' || req.query.desc === undefined) ? '' : 'DESC'} 
                                        LIMIT ${req.query.limit}::TEXT::INTEGER`);
        result.forEach((elem) => {
            elem.thread = Number(elem.thread);
            elem.parent = Number(elem.parent);
        })
        res.status(200).send(result);
        return;
    } else if(req.query.sort === 'parent_tree') {
        let query;
        if (req.query.since === undefined) {
            if (req.query.desc === 'false' || req.query.desc === undefined) {
                query = await db.query(`SELECT * FROM posts
                                        WHERE path[1] IN (SELECT id FROM posts WHERE thread = $1 AND parent = 0 ORDER BY id LIMIT $2)
                                        ORDER BY path;`,
                    [have[0].id, req.query.limit]);
            } else {
                query = await db.query(`SELECT * FROM posts
                                        WHERE path[1] IN (SELECT id FROM posts WHERE thread = $1 AND parent = 0 ORDER BY id DESC LIMIT $2)
                                        ORDER BY path[1] DESC, path ASC;`,
                    [have[0].id, req.query.limit]);
            }
        } else {
            if (req.query.desc === 'false' || req.query.desc === undefined) {
                query = await db.query(`SELECT * FROM posts
					WHERE path[1] IN (SELECT id FROM posts WHERE thread = $1 AND parent = 0 AND id >
					(SELECT path[1] FROM posts WHERE id = $2) ORDER BY id LIMIT $3) 
					ORDER BY path;`,
                    [have[0].id, req.query.since, req.query.limit]);
            } else {
                query = await db.query(`SELECT * FROM posts
                                        WHERE path[1] IN (SELECT id FROM posts WHERE thread = $1 AND parent = 0 AND id < (SELECT path[1] FROM posts WHERE id = $2)
                                                          ORDER BY id DESC LIMIT $3) ORDER BY path[1] DESC, path ASC;`,
                    [have[0].id, req.query.since, req.query.limit]);
            }
        }
        query.forEach((elem) => {
            elem.thread = Number(elem.thread);
            elem.parent = Number(elem.parent);
        })
        res.status(200).send(query);
    } else {
        const result = await db.query(`SELECT *
                                       FROM posts
                                       WHERE thread = ${have[0].id} ${(req.query.since !== undefined) ?
            (req.query.desc === 'false' || req.query.desc === undefined) ? `AND id > ${req.query.since}`
                : `AND id < ${req.query.since}` :
            ''}
                                       ORDER BY id ${(req.query.desc === 'false' || req.query.desc === undefined) ? '' : 'DESC'}
                                           LIMIT ${req.query.limit}::TEXT::INTEGER;`);
        result.forEach((elem) => {
            elem.thread = Number(elem.thread);
            elem.parent = Number(elem.parent);
        });
        res.status(200).send(result);
    }
});

// VOTE
app.post('/api/thread/:slug_or_id/vote', async (req, res) => {
    const slugOrId = req.params.slug_or_id;
    let have;
    if (!isNaN(slugOrId)) {
        have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with id ${slugOrId}\n`});
            return;
        }
    } else {
        have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with slug ${slugOrId}\n`});
            return;
        }
    }
    const userCheck = await db.query('SELECT * FROM users WHERE nickname = $1', [req.body.nickname]);
    if (userCheck.length === 0) {
        res.status(404).send({message: `Can't find user by nickname: ${req.body.nickname}`});
        return;
    }
    const likeCheck = await db.query('SELECT * FROM votes WHERE nickname = $1 AND thread_id = $2', [req.body.nickname, have[0].id]);
    if (likeCheck.length !== 0 || (likeCheck.length !== 0 && req.body.voice === -1 && likeCheck[0].voice === 0)) {
        if (req.body.voice === -1 && likeCheck[0].voice === 1) {
            await db.query(`UPDATE votes SET voice = $1 WHERE thread_id = $2 AND nickname = $3 and voice != $1 RETURNING *;`, [-1, have[0].id, req.body.nickname]);
        } else if (req.body.voice === 1 && likeCheck[0].voice === -1) {
            await db.query(`UPDATE votes SET voice = $1 WHERE thread_id = $2 AND nickname = $3 and voice != $1;`, [1, have[0].id, req.body.nickname]);
        } else {
            res.status(200).send(have[0]);
            return;
        }
    } else {
        await db.query('INSERT INTO votes (voice, thread_id, nickname) VALUES ($1, $2, $3)', [req.body.voice, have[0].id, req.body.nickname])
    }

    if (!isNaN(slugOrId)) {
        have = await db.query('SELECT * FROM threads WHERE id = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with id ${slugOrId}\n`});
            return;
        }
    } else {
        have = await db.query('SELECT * FROM threads WHERE slug = $1', [slugOrId]);
        if (have.length === 0) {
            res.status(404).send({message: `Can't find thread with slug ${slugOrId}\n`});
            return;
        }
    }
    res.status(200).send(have[0]);
});

// USER
app.post('/api/user/:nickname/create', async (req, res) => {
    const nickname = req.params.nickname;
    const user = await db.query('SELECT * FROM users WHERE nickname = $1 OR email = $2',
        [nickname, req.body.email]);
    if (user.length !== 0) {
        res.status(409).send(user);
        return;
    }

    await db.query('INSERT INTO users (nickname, email, fullname, about) VALUES ($1, $2, $3, $4);',
        [nickname, req.body.email, req.body.fullname, req.body.about]);
    res.status(201).send({nickname, fullname: req.body.fullname, about: req.body.about, email: req.body.email});
});

app.get('/api/user/:nickname/profile', async (req, res) => {
    const nickname = req.params.nickname;
    const user = await db.query('SELECT * FROM users WHERE nickname = $1',
        [nickname]);
    if (user.length === 0) {
        res.status(404).send({message: `Can't find user with nickname ${nickname}\n`});
        return;
    }
    res.status(200).send(user[0]);
});

app.post('/api/user/:nickname/profile', async (req, res) => {
    const nickname = req.params.nickname;
    const user = await db.query('SELECT * FROM users WHERE nickname = $1',
        [nickname]);
    if (user.length === 0) {
        res.status(404).send({message: `Can't find user with nickname ${nickname}\n`});
        return;
    }

    const email = await db.query('SELECT * FROM users WHERE email = $1',
        [req.body.email]);
    if (email.length !== 0) {
        res.status(409).send({message: `Find user with email ${email[0].email}\n`});
        return;
    }

    const result = await db.query('UPDATE users SET email = COALESCE(NULLIF($1, \'\'), email), fullname = COALESCE(NULLIF($2, \'\'), fullname), about = COALESCE(NULLIF($3, \'\'), about) WHERE nickname = $4 RETURNING *',
        [req.body.email, req.body.fullname, req.body.about, nickname]);
    res.status(200).send(result[0]);
});

// POST

app.get('/api/post/:id/details', async (req, res) => {
    const id = req.params.id;
    let query = req.query.related;
    if (query === undefined) {
        query = [];
    } else {
        query = req.query.related.split(',');
    }
    let endResult = {};
    let result;
    const post = await db.query(`SELECT id, parent, author, message, isedited, forum, thread, created FROM posts WHERE id = $1;`, [id]);
    if (post.length === 0) {
        res.status(404).send({message: `Can't find user with id ${id}\n`});
        return;
    }
    post.forEach((elem) => {
        elem.parent = Number(elem.parent);
        elem.thread = Number(elem.thread);
        elem.isEdited = elem.isedited;
    });
    endResult.post = post[0];
    for (const elem of query){
        if (elem === 'user') {
            result = await db.query(`SELECT nickname, fullname, about, email FROM users WHERE nickname = $1;`, [post[0].author]);
            endResult.author = result[0];
        } else if (elem === 'forum') {
            result = await db.query(`SELECT slug, title, "user", posts, threads FROM forums WHERE slug = $1;`, [post[0].forum]);
            result.forEach((elem) => {
                elem.posts = Number(elem.posts);
                elem.threads = Number(elem.threads);
            });
            endResult.forum = result[0];
        } else if (elem === 'thread') {
            result = await db.query(`SELECT id, title, author, forum, message, votes, slug, created FROM threads WHERE id = $1`, [post[0].thread]);
            endResult.thread = result[0];
        }
    }
    res.status(200).send(endResult);
});

app.post('/api/post/:id/details', async (req, res) => {
    const id = req.params.id;
    let message = req.body.message;
    let answer;
    if (message === undefined) {
        answer = await db.query(`SELECT * FROM posts WHERE id = $1;`, [id]);
        if (answer.length === 0) {
            res.status(404).send({message: `Can't find message with id ${id}\n`});
        } else {
            answer[0].thread = Number(answer[0].thread);
            answer[0].parent = Number(answer[0].parent);
            answer[0].isEdited = answer[0].isedited;
            res.status(200).send(answer[0]);
        }
    } else {
        answer = await db.query(`UPDATE posts SET message = $1, isedited = true WHERE id = $2 AND message != $1 RETURNING id, parent, author, message, isEdited, forum, thread, created;`, [message ,id]);
        if (answer.length === 0) {
            answer = await db.query(`SELECT * FROM posts WHERE id = $1;`, [id]);
            if (answer.length === 0) {
                res.status(404).send({message: `Can't find message with id ${id}\n`});
            } else {
                answer[0].thread = Number(answer[0].thread);
                answer[0].parent = Number(answer[0].parent);
                res.status(200).send(answer[0]);
            }
        } else {
            answer[0].thread = Number(answer[0].thread);
            answer[0].parent = Number(answer[0].parent);
            answer[0].isEdited = true;
            res.status(200).send(answer[0]);
        }
    }
});

app.listen(port, () => {
    console.log(`Server listening port ${port}`);
});