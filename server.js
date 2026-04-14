const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(String(process.env.PORT || '3000'), 10) || 3000;

if (isProduction) {
    const sec = process.env.SESSION_SECRET;
    if (!sec || String(sec).length < 24) {
        console.error(
            '[mfumo] FATAL: NODE_ENV=production requires SESSION_SECRET (random string, at least 24 characters).'
        );
        console.error('[mfumo] For local testing, set NODE_ENV=development (or unset NODE_ENV) then set SESSION_SECRET when you deploy.');
        process.exit(1);
    }
}

const SESSION_SECRET =
    process.env.SESSION_SECRET || 'dev-only-do-not-use-in-production-set-SESSION_SECRET';

if (!isProduction && !process.env.SESSION_SECRET) {
    console.warn(
        '[mfumo] SESSION_SECRET is not set — using a dev-only default. Set SESSION_SECRET for staging or production.'
    );
}

app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
app.use(express.static('public'));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'uchaguzi.sid',
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

const DATABASE_PATH = process.env.VOTING_DB_PATH
    ? path.resolve(process.cwd(), process.env.VOTING_DB_PATH)
    : path.join(__dirname, 'voting.db');

const db = new sqlite3.Database(DATABASE_PATH);

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

const DEFAULT_ELECTION_TITLE = 'EAST AFRICA CHANGEMAKERS AWARDS';
const DEFAULT_ELECTION_DESCRIPTION =
    'East Africa changemakers awards. Admins add nominees and open voting from the admin panel.';

function runDatabaseMigrations(done) {
    db.all('PRAGMA table_info(candidates)', (err, cols) => {
        if (err) {
            return done(err);
        }
        const hasCatCol = cols.some((c) => c.name === 'category_id');

        const backfillThenVotes = () => {
            db.run(
                `INSERT INTO categories (election_id, name, description, sort_order)
                 SELECT e.id, 'General', 'Default category (legacy data)', 0
                 FROM elections e
                 WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.election_id = e.id)`,
                (e1) => {
                    if (e1) {
                        console.error('[mfumo] migrate categories:', e1.message);
                    }
                    db.run(
                        `UPDATE candidates SET category_id = (
                            SELECT c.id FROM categories c WHERE c.election_id = candidates.election_id
                            ORDER BY c.sort_order ASC, c.id ASC LIMIT 1
                        ) WHERE category_id IS NULL AND election_id IS NOT NULL`,
                        (e2) => {
                            if (e2) {
                                console.error('[mfumo] migrate category_id:', e2.message);
                            }
                            migrateVotesToPerCategory(done);
                        }
                    );
                }
            );
        };

        if (!hasCatCol) {
            db.run('ALTER TABLE candidates ADD COLUMN category_id INTEGER', (acErr) => {
                if (acErr) {
                    console.error('[mfumo] ALTER candidates:', acErr.message);
                }
                backfillThenVotes();
            });
        } else {
            backfillThenVotes();
        }
    });
}

function migrateVotesToPerCategory(done) {
    db.all('PRAGMA table_info(votes)', (err, cols) => {
        if (err) {
            return done(err);
        }
        if (cols.some((c) => c.name === 'category_id')) {
            return done();
        }

        db.serialize(() => {
            db.run(`CREATE TABLE votes_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                election_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                candidate_id INTEGER NOT NULL,
                voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, category_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (election_id) REFERENCES elections(id),
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (candidate_id) REFERENCES candidates(id)
            )`);

            db.run(
                `INSERT INTO votes_new (user_id, election_id, category_id, candidate_id, voted_at)
                 SELECT v.user_id, v.election_id, c.category_id, v.candidate_id, v.voted_at
                 FROM votes v
                 INNER JOIN candidates c ON c.id = v.candidate_id
                 WHERE c.category_id IS NOT NULL`,
                () => {
                    db.run('DROP TABLE votes', () => {
                        db.run('ALTER TABLE votes_new RENAME TO votes', (reErr) => {
                            if (reErr) {
                                console.error('[mfumo] rename votes:', reErr.message);
                            }
                            done(reErr);
                        });
                    });
                }
            );
        });
    });
}

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'voter',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS elections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        start_date DATETIME,
        end_date DATETIME,
        is_active BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        election_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (election_id) REFERENCES elections (id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        election_id INTEGER,
        category_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        FOREIGN KEY (election_id) REFERENCES elections (id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        election_id INTEGER,
        candidate_id INTEGER,
        voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (election_id) REFERENCES elections (id),
        FOREIGN KEY (candidate_id) REFERENCES candidates (id),
        UNIQUE(user_id, election_id)
    )`);

    db.get(
        'SELECT id FROM elections WHERE title = ?',
        [DEFAULT_ELECTION_TITLE],
        (err, row) => {
            if (err) {
                console.error('[mfumo] ensure default election:', err.message);
                return;
            }
            if (row) return;
            db.run(
                'INSERT INTO elections (title, description, start_date, end_date, is_active) VALUES (?, ?, NULL, NULL, 0)',
                [DEFAULT_ELECTION_TITLE, DEFAULT_ELECTION_DESCRIPTION],
                (e2) => {
                    if (e2) {
                        console.error('[mfumo] insert default election:', e2.message);
                        return;
                    }
                    console.log('[mfumo] Default election added:', DEFAULT_ELECTION_TITLE);
                }
            );
        }
    );

    db.run('SELECT 1', () => {
        runDatabaseMigrations((mErr) => {
            if (!mErr) {
                console.log('[mfumo] Database schema verified (categories + per-category votes).');
            }
            removeLegacyDemoAccounts(() => {});
        });
    });
});

/** Removes old demo users (demo / msimamizi) and their votes so the DB stays clean. Safe if rows do not exist. */
function removeLegacyDemoAccounts(done) {
    db.run(
        `DELETE FROM votes WHERE user_id IN (SELECT id FROM users WHERE username COLLATE NOCASE IN ('demo', 'msimamizi'))`,
        (e1) => {
            if (e1) {
                console.error('[mfumo] remove demo votes:', e1.message);
                if (done) done(e1);
                return;
            }
            db.run(
                `DELETE FROM users WHERE username COLLATE NOCASE IN ('demo', 'msimamizi')`,
                function (e2) {
                    if (e2) {
                        console.error('[mfumo] remove demo users:', e2.message);
                    } else if (this.changes > 0) {
                        console.log(
                            `[mfumo] Removed legacy demo accounts (${this.changes} user row(s)) and their votes.`
                        );
                    }
                    if (done) done(e2);
                }
            );
        }
    );
}

function electionAcceptsVotes(row) {
    if (!row || !row.is_active) return false;
    const now = Date.now();
    if (row.start_date) {
        const t = new Date(row.start_date).getTime();
        if (!Number.isNaN(t) && now < t) return false;
    }
    if (row.end_date) {
        const t = new Date(row.end_date).getTime();
        if (!Number.isNaN(t) && now > t) return false;
    }
    return true;
}

function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    if (req.path && req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Please sign in first' });
    }
    return res.redirect('/login');
}

function isAdmin(req, res, next) {
    if (req.session.role === 'admin') return next();
    if (req.path.startsWith('/api')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    return res.redirect('/vote');
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/vote', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not signed in' });
    }
    res.json({
        user: {
            id: req.session.userId,
            username: req.session.username,
            role: req.session.role
        }
    });
});

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Please fill in all required fields' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", [], (roleErr, adminRow) => {
            if (roleErr) {
                return res.status(500).json({ error: 'Registration failed' });
            }
            const role = adminRow ? 'voter' : 'admin';

            db.run(
                'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
                [String(username).trim(), String(email).trim(), hashedPassword, role],
                function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: 'Username or email is already taken' });
                        }
                        return res.status(500).json({ error: 'Registration failed' });
                    }
                    res.status(201).json({
                        message: 'Registration successful',
                        role
                    });
                }
            );
        });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    const p = String(password || '');
    if (!u || !p) {
        return res.status(400).json({ error: 'Enter username and password' });
    }

    db.get(
        'SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE',
        [u, u],
        async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const isMatch = await bcrypt.compare(p, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;

        res.json({
            message: 'Signed in successfully',
            user: { id: user.id, username: user.username, role: user.role }
        });
        }
    );
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('uchaguzi.sid');
        res.json({ message: 'Signed out successfully' });
    });
});

app.get('/api/elections', (req, res) => {
    db.all('SELECT * FROM elections ORDER BY created_at DESC', (err, elections) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to load elections' });
        }
        res.json(elections);
    });
});

app.get('/api/elections/active', (req, res) => {
    db.all('SELECT * FROM elections WHERE is_active = 1 ORDER BY created_at DESC', (err, elections) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to load elections' });
        }
        const open = (elections || []).filter(electionAcceptsVotes);
        res.json(open);
    });
});

app.post('/api/elections', isAuthenticated, isAdmin, (req, res) => {
    const { title, description, start_date, end_date, default_category, default_category_name } = req.body || {};
    if (!title || !String(title).trim()) {
        return res.status(400).json({ error: 'Election title is required' });
    }

    const wantDefaultCat = default_category === true || default_category === 'true' || default_category === 1;
    const catName =
        wantDefaultCat && default_category_name && String(default_category_name).trim()
            ? String(default_category_name).trim()
            : wantDefaultCat
              ? 'All nominees'
              : null;

    db.run(
        'INSERT INTO elections (title, description, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)',
        [String(title).trim(), description || null, start_date || null, end_date || null, 0],
        function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to create election' });
            }
            const electionId = this.lastID;
            if (!wantDefaultCat || !catName) {
                return res.status(201).json({ message: 'Election created', electionId });
            }
            db.run(
                'INSERT INTO categories (election_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
                [electionId, catName, null, 0],
                function (e2) {
                    if (e2) {
                        return res.status(500).json({ error: 'Election created but default category failed' });
                    }
                    res.status(201).json({
                        message: 'Election created with one default category',
                        electionId,
                        defaultCategoryId: this.lastID
                    });
                }
            );
        }
    );
});

app.get('/api/elections/:id/categories', (req, res) => {
    const electionId = req.params.id;
    db.all(
        'SELECT * FROM categories WHERE election_id = ? ORDER BY sort_order ASC, id ASC',
        [electionId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to load categories' });
            }
            res.json(rows || []);
        }
    );
});

app.post('/api/elections/:id/categories', isAuthenticated, isAdmin, (req, res) => {
    const electionId = req.params.id;
    const { name, description, sort_order } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Category name is required' });
    }

    const order = sort_order != null ? parseInt(sort_order, 10) || 0 : 0;
    db.run(
        'INSERT INTO categories (election_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
        [electionId, String(name).trim(), description || null, order],
        function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to add category' });
            }
            res.status(201).json({ message: 'Category added', categoryId: this.lastID });
        }
    );
});

app.delete('/api/elections/:electionId/categories/:categoryId', isAuthenticated, isAdmin, (req, res) => {
    const { electionId, categoryId } = req.params;

    db.get(
        'SELECT id FROM categories WHERE id = ? AND election_id = ?',
        [categoryId, electionId],
        (err, row) => {
            if (err || !row) {
                return res.status(404).json({ error: 'Category not found' });
            }

            db.get('SELECT COUNT(*) AS n FROM votes WHERE category_id = ?', [categoryId], (e2, countRow) => {
                if (e2) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (countRow && countRow.n > 0) {
                    return res.status(400).json({ error: 'Cannot delete a category that already has votes' });
                }

                db.run('DELETE FROM categories WHERE id = ? AND election_id = ?', [categoryId, electionId], function (e3) {
                    if (e3) {
                        return res.status(500).json({ error: 'Failed to delete category' });
                    }
                    res.json({ message: 'Category deleted' });
                });
            });
        }
    );
});

app.get('/api/elections/:id/candidates', (req, res) => {
    const electionId = req.params.id;
    db.all(
        `SELECT c.*, cat.name AS category_name
         FROM candidates c
         LEFT JOIN categories cat ON cat.id = c.category_id
         WHERE c.election_id = ?
         ORDER BY cat.sort_order ASC, cat.id ASC, c.id ASC`,
        [electionId],
        (err, candidates) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to load candidates' });
            }
            res.json(candidates || []);
        }
    );
});

app.get('/api/categories/:categoryId/candidates', (req, res) => {
    const categoryId = req.params.categoryId;
    db.all(
        'SELECT * FROM candidates WHERE category_id = ? ORDER BY id ASC',
        [categoryId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to load nominees' });
            }
            res.json(rows || []);
        }
    );
});

app.post('/api/categories/:categoryId/candidates', isAuthenticated, isAdmin, (req, res) => {
    const categoryId = req.params.categoryId;
    const { name, description, image_url } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Nominee name is required' });
    }

    db.get(
        'SELECT election_id FROM categories WHERE id = ?',
        [categoryId],
        (err, cat) => {
            if (err || !cat) {
                return res.status(404).json({ error: 'Category not found' });
            }

            db.run(
                'INSERT INTO candidates (election_id, category_id, name, description, image_url) VALUES (?, ?, ?, ?, ?)',
                [cat.election_id, categoryId, String(name).trim(), description || null, image_url || null],
                function (e2) {
                    if (e2) {
                        return res.status(500).json({ error: 'Failed to add nominee' });
                    }
                    res.status(201).json({ message: 'Nominee added', candidateId: this.lastID });
                }
            );
        }
    );
});

app.delete('/api/categories/:categoryId/candidates/:candidateId', isAuthenticated, isAdmin, (req, res) => {
    const { categoryId, candidateId } = req.params;

    db.get(
        'SELECT id FROM candidates WHERE id = ? AND category_id = ?',
        [candidateId, categoryId],
        (err, row) => {
            if (err || !row) {
                return res.status(404).json({ error: 'Nominee not found' });
            }

            db.get('SELECT COUNT(*) AS n FROM votes WHERE candidate_id = ?', [candidateId], (e2, countRow) => {
                if (e2) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (countRow && countRow.n > 0) {
                    return res.status(400).json({ error: 'Cannot delete a nominee who has votes' });
                }

                db.run('DELETE FROM candidates WHERE id = ? AND category_id = ?', [candidateId, categoryId], function (e3) {
                    if (e3) {
                        return res.status(500).json({ error: 'Failed to delete nominee' });
                    }
                    res.json({ message: 'Nominee deleted' });
                });
            });
        }
    );
});

app.get('/api/voting/active-ballots', isAuthenticated, async (req, res) => {
    try {
        const elections = await dbAll('SELECT * FROM elections WHERE is_active = 1 ORDER BY created_at DESC');
        const open = elections.filter(electionAcceptsVotes);
        if (open.length === 0) {
            return res.json([]);
        }

        const out = [];
        for (const election of open) {
            const categories = await dbAll(
                'SELECT * FROM categories WHERE election_id = ? ORDER BY sort_order ASC, id ASC',
                [election.id]
            );
            const catBlocks = [];
            for (const cat of categories) {
                const cands = await dbAll(
                    'SELECT id, name, description, image_url FROM candidates WHERE category_id = ? ORDER BY id ASC',
                    [cat.id]
                );
                catBlocks.push({
                    id: cat.id,
                    name: cat.name,
                    description: cat.description,
                    sort_order: cat.sort_order,
                    candidates: cands
                });
            }
            out.push({ election, categories: catBlocks });
        }
        out.sort((x, y) => y.election.id - x.election.id);
        res.json(out);
    } catch {
        res.status(500).json({ error: 'Failed to load ballots' });
    }
});

app.get('/api/my-votes', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    db.all(
        'SELECT election_id, category_id, candidate_id FROM votes WHERE user_id = ?',
        [userId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to load vote status' });
            }
            res.json(rows || []);
        }
    );
});

app.post('/api/vote/batch', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    const { electionId, selections } = req.body || {};

    if (!electionId || !Array.isArray(selections) || selections.length === 0) {
        return res.status(400).json({ error: 'Select at least one category and nominee' });
    }

    const electionIdNum = parseInt(electionId, 10);

    db.get('SELECT * FROM elections WHERE id = ?', [electionIdNum], (err, election) => {
        if (err || !election) {
            return res.status(404).json({ error: 'Election not found' });
        }
        if (!electionAcceptsVotes(election)) {
            return res.status(403).json({ error: 'This election is not open for voting right now' });
        }

        db.all(
            'SELECT id FROM categories WHERE election_id = ?',
            [electionIdNum],
            async (e2, allCats) => {
                try {
                if (e2) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (!allCats || allCats.length === 0) {
                    return res.status(400).json({ error: 'This election has no categories yet' });
                }

                const catIds = new Set(allCats.map((c) => c.id));
                const seen = new Set();
                const normalized = [];

                for (const s of selections) {
                    const cid = parseInt(s.categoryId, 10);
                    const candId = parseInt(s.candidateId, 10);
                    if (!cid || !candId) {
                        return res.status(400).json({ error: 'Each vote must include a category and a nominee' });
                    }
                    if (!catIds.has(cid)) {
                        return res.status(400).json({ error: 'Category does not belong to this election' });
                    }
                    if (seen.has(cid)) {
                        return res.status(400).json({ error: 'Duplicate category in this request' });
                    }
                    seen.add(cid);
                    normalized.push({ categoryId: cid, candidateId: candId });
                }

                for (const row of normalized) {
                    const ok = await new Promise((resolve) => {
                        db.get(
                            `SELECT c.id FROM candidates c
                             INNER JOIN categories cat ON cat.id = c.category_id
                             WHERE c.id = ? AND c.category_id = ? AND cat.election_id = ?`,
                            [row.candidateId, row.categoryId, electionIdNum],
                            (e3, r) => resolve(!!r)
                        );
                    });
                    if (!ok) {
                        return res.status(400).json({ error: 'Nominee is not valid for that category' });
                    }
                }

                const toInsert = [];
                for (const row of normalized) {
                    const existing = await dbGet(
                        'SELECT id, candidate_id FROM votes WHERE user_id = ? AND category_id = ?',
                        [userId, row.categoryId]
                    );
                    if (existing) {
                        return res.status(400).json({ error: 'You already voted in one of the selected categories' });
                    }
                    toInsert.push(row);
                }

                if (toInsert.length === 0) {
                    return res.json({ message: 'No new votes to save' });
                }

                await new Promise((resolve, reject) => {
                    db.run('BEGIN TRANSACTION', (bErr) => (bErr ? reject(bErr) : resolve()));
                });

                try {
                    for (const row of toInsert) {
                        await new Promise((resolve, reject) => {
                            db.run(
                                'INSERT INTO votes (user_id, election_id, category_id, candidate_id) VALUES (?, ?, ?, ?)',
                                [userId, electionIdNum, row.categoryId, row.candidateId],
                                (ie) => (ie ? reject(ie) : resolve())
                            );
                        });
                    }
                    await new Promise((resolve, reject) => {
                        db.run('COMMIT', (ce) => (ce ? reject(ce) : resolve()));
                    });
                    res.json({ message: 'Your votes have been saved' });
                } catch (insErr) {
                    await new Promise((r) => db.run('ROLLBACK', () => r()));
                    if (insErr && insErr.message && insErr.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'You have already voted in this category' });
                    }
                    return res.status(500).json({ error: 'Failed to save votes' });
                }
                } catch {
                    return res.status(500).json({ error: 'Failed to save votes' });
                }
            }
        );
    });
});

/**
 * Vote counts: each INSERT into `votes` is one choice (one user, one category, one nominee).
 * Results sum COUNT(votes) per candidate within each category (see SQL below).
 */
app.get('/api/elections/:id/results', (req, res) => {
    const electionId = req.params.id;

    db.all(
        'SELECT * FROM categories WHERE election_id = ? ORDER BY sort_order ASC, id ASC',
        [electionId],
        (err, categories) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to load results' });
            }
            if (!categories || categories.length === 0) {
                return res.json({ categories: [] });
            }

            let left = categories.length;
            const blocks = [];

            categories.forEach((cat) => {
                const q = `
                    SELECT c.id, c.name, c.description, COUNT(v.id) AS vote_count
                    FROM candidates c
                    LEFT JOIN votes v ON v.candidate_id = c.id AND v.category_id = c.category_id
                    WHERE c.category_id = ?
                    GROUP BY c.id, c.name, c.description
                    ORDER BY vote_count DESC, c.name ASC
                `;
                db.all(q, [cat.id], (e2, results) => {
                    blocks.push({
                        id: cat.id,
                        name: cat.name,
                        description: cat.description,
                        candidates: results || []
                    });
                    left -= 1;
                    if (left === 0) {
                        blocks.sort((a, b) => {
                            const ca = categories.find((x) => x.id === a.id);
                            const cb = categories.find((x) => x.id === b.id);
                            return (ca.sort_order || 0) - (cb.sort_order || 0) || a.id - b.id;
                        });
                        res.json({ categories: blocks });
                    }
                });
            });
        }
    );
});

app.put('/api/elections/:id/toggle', isAuthenticated, isAdmin, (req, res) => {
    const electionId = req.params.id;
    db.run('UPDATE elections SET is_active = NOT is_active WHERE id = ?', [electionId], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to update election status' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Election not found' });
        }
        res.json({ message: 'Election status updated' });
    });
});

app.get('/api/admin/stats', isAuthenticated, isAdmin, (req, res) => {
    db.get(
        `SELECT
            (SELECT COUNT(*) FROM elections) AS total_elections,
            (SELECT COUNT(*) FROM elections WHERE is_active = 1) AS active_elections,
            (SELECT COUNT(*) FROM categories) AS total_categories,
            (SELECT COUNT(*) FROM candidates) AS total_candidates,
            (SELECT COUNT(*) FROM votes) AS total_votes`,
        (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Failed to load statistics' });
            }
            res.json({
                totalElections: row.total_elections,
                activeElections: row.active_elections,
                totalCategories: row.total_categories,
                totalCandidates: row.total_candidates,
                totalVotes: row.total_votes
            });
        }
    );
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[mfumo] Voting app listening on port ${PORT}${isProduction ? ' (production)' : ' (development)'}`);
    console.log(`[mfumo] Open in your browser: http://127.0.0.1:${PORT}/`);
    if (!isProduction) {
        console.log('[mfumo] Database file:', DATABASE_PATH);
    }
});

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`[mfumo] Port ${PORT} is already in use. Close the other app or run:`);
        console.error(`[mfumo]   set PORT=3010 && node server.js`);
    } else {
        console.error('[mfumo] Server failed to start:', err && err.message ? err.message : err);
    }
    process.exit(1);
});
