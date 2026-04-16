const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// Load .env for local/dev. In production, hosts often set env vars directly.
try {
    require('dotenv').config();
} catch {}

const sqlite3 = require('sqlite3').verbose();
const SQLiteStore = require('connect-sqlite3')(session);

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

// DB file (durable). Put it on persistent storage on your host.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'voting.db');
const DB_DIR = path.dirname(DB_PATH);
fs.mkdirSync(DB_DIR, { recursive: true });

app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
// Consistent charset avoids flaky hosting "health checks" that compare Content-Type before/after npm install.
app.use(
    express.static('public', {
        setHeaders(res, filePath) {
            if (/\.html?$/i.test(filePath)) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
            }
        }
    })
);

function sendPublicHtml(res, filename) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', filename));
}

const db = new sqlite3.Database(DB_PATH);

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

app.use(
    session({
        store: new SQLiteStore({
            // Keep sessions alongside DB (durable).
            dir: DB_DIR,
            db: path.basename(DB_PATH) + '.sessions',
            table: 'session'
        }),
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        name: 'uchaguzi.sid',
        cookie: {
            // If you terminate TLS at a reverse proxy, keep trust proxy above so secure cookies work.
            secure: isProduction,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

const DEFAULT_ELECTION_TITLE = 'EAST AFRICA CHANGEMAKERS AWARDS';
const DEFAULT_ELECTION_DESCRIPTION =
    'East Africa changemakers awards. Admins add nominees and open voting from the admin panel.';

/** Removes old demo users (demo / msimamizi) and their votes so the DB stays clean. */
async function removeLegacyDemoAccounts() {
    await dbRun(
        `DELETE FROM votes WHERE user_id IN (SELECT id FROM users WHERE lower(username) IN ('demo', 'msimamizi'))`
    );
    const delUsers = await dbRun(
        `DELETE FROM users WHERE lower(username) IN ('demo', 'msimamizi')`
    );
    const n = Number(delUsers.changes || 0);
    if (n > 0) {
        console.log(`[mfumo] Removed legacy demo accounts (${n} user row(s)) and their votes.`);
    }
}

async function seedInitialAdminIfNeeded() {
    const adminRow = await dbGet("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (adminRow) return;

    const username = String(process.env.ADMIN_USERNAME || '').trim();
    const email = String(process.env.ADMIN_EMAIL || '').trim();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!username || !email || !password) return;

    if (password.length < 8) {
        console.warn('[mfumo] ADMIN_PASSWORD is too short (min 8). Skipping admin seed.');
        return;
    }

    try {
        const hashed = await bcrypt.hash(password, 10);
        await dbRun(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [username, email, hashed, 'admin']
        );
        console.log(`[mfumo] Seeded initial admin user: ${username}`);
    } catch (e) {
        console.warn(
            '[mfumo] Could not seed initial admin user:',
            e && e.message ? e.message : e
        );
    }
}

async function initDatabase() {
    try {
        await dbRun('PRAGMA foreign_keys = ON');

        await dbRun(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'voter',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS elections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            start_date TEXT,
            end_date TEXT,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);

        await dbRun(`CREATE INDEX IF NOT EXISTS idx_categories_election_order
            ON categories (election_id, sort_order, id)`);

        await dbRun(`CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT,
            image_url TEXT
        )`);

        await dbRun(`CREATE INDEX IF NOT EXISTS idx_candidates_category
            ON candidates (category_id, id)`);

        await dbRun(`CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            voted_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (user_id, category_id)
        )`);

        await dbRun('CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes (candidate_id)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_votes_category ON votes (category_id)');

        const existing = await dbGet('SELECT id FROM elections WHERE title = ? LIMIT 1', [
            DEFAULT_ELECTION_TITLE
        ]);
        if (!existing) {
            await dbRun(
                'INSERT INTO elections (title, description, start_date, end_date, is_active) VALUES (?, ?, NULL, NULL, 0)',
                [DEFAULT_ELECTION_TITLE, DEFAULT_ELECTION_DESCRIPTION]
            );
            console.log('[mfumo] Default election added:', DEFAULT_ELECTION_TITLE);
        }

        await seedInitialAdminIfNeeded();
        await removeLegacyDemoAccounts();
        console.log('[mfumo] Database schema verified (SQLite).');
    } catch (e) {
        console.error('[mfumo] FATAL: Database init failed:', e && e.message ? e.message : e);
        process.exit(1);
    }
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
    sendPublicHtml(res, 'index.html');
});

app.get('/login', (req, res) => {
    sendPublicHtml(res, 'login.html');
});

app.get('/register', (req, res) => {
    sendPublicHtml(res, 'register.html');
});

app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    sendPublicHtml(res, 'admin.html');
});

app.get('/vote', isAuthenticated, (req, res) => {
    sendPublicHtml(res, 'vote.html');
});

app.get('/results', (req, res) => {
    sendPublicHtml(res, 'results.html');
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
        const adminRow = await dbGet("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        const role = adminRow ? 'voter' : 'admin';
        await dbRun(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [String(username).trim(), String(email).trim(), hashedPassword, role]
        );
        res.status(201).json({
            message: 'Registration successful',
            role
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

    (async () => {
        try {
            const user = await dbGet(
                'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)',
                [u]
            );
            if (!user) {
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
        } catch {
            res.status(500).json({ error: 'Server error' });
        }
    })();
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('uchaguzi.sid');
        res.json({ message: 'Signed out successfully' });
    });
});

app.get('/api/elections', (req, res) => {
    (async () => {
        try {
            const elections = await dbAll('SELECT * FROM elections ORDER BY created_at DESC');
            res.json(elections);
        } catch {
            res.status(500).json({ error: 'Failed to load elections' });
        }
    })();
});

app.get('/api/elections/active', (req, res) => {
    (async () => {
        try {
            const elections = await dbAll(
                'SELECT * FROM elections WHERE is_active = 1 ORDER BY created_at DESC'
            );
            const open = (elections || []).filter(electionAcceptsVotes);
            res.json(open);
        } catch {
            res.status(500).json({ error: 'Failed to load elections' });
        }
    })();
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

    (async () => {
        try {
            const r = await dbRun(
                'INSERT INTO elections (title, description, start_date, end_date, is_active) VALUES (?, ?, ?, ?, 0)',
                [String(title).trim(), description || null, start_date || null, end_date || null]
            );
            const electionId = r.lastID;
            if (!wantDefaultCat || !catName) {
                return res.status(201).json({ message: 'Election created', electionId });
            }
            const r2 = await dbRun(
                'INSERT INTO categories (election_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
                [electionId, catName, null, 0]
            );
            res.status(201).json({
                message: 'Election created with one default category',
                electionId,
                defaultCategoryId: r2.lastID
            });
        } catch {
            res.status(500).json({ error: 'Failed to create election' });
        }
    })();
});

app.get('/api/elections/:id/categories', (req, res) => {
    const electionId = req.params.id;
    (async () => {
        try {
            const rows = await dbAll(
                'SELECT * FROM categories WHERE election_id = ? ORDER BY sort_order ASC, id ASC',
                [electionId]
            );
            res.json(rows || []);
        } catch {
            res.status(500).json({ error: 'Failed to load categories' });
        }
    })();
});

app.post('/api/elections/:id/categories', isAuthenticated, isAdmin, (req, res) => {
    const electionId = req.params.id;
    const { name, description, sort_order } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Category name is required' });
    }

    const order = sort_order != null ? parseInt(sort_order, 10) || 0 : 0;
    (async () => {
        try {
            const r = await dbRun(
                'INSERT INTO categories (election_id, name, description, sort_order) VALUES (?, ?, ?, ?)',
                [electionId, String(name).trim(), description || null, order]
            );
            res.status(201).json({ message: 'Category added', categoryId: r.lastID });
        } catch {
            res.status(500).json({ error: 'Failed to add category' });
        }
    })();
});

app.delete('/api/elections/:electionId/categories/:categoryId', isAuthenticated, isAdmin, (req, res) => {
    const { electionId, categoryId } = req.params;
    (async () => {
        try {
            const row = await dbGet(
                'SELECT id FROM categories WHERE id = ? AND election_id = ?',
                [categoryId, electionId]
            );
            if (!row) {
                return res.status(404).json({ error: 'Category not found' });
            }

            const countRow = await dbGet('SELECT COUNT(*) AS n FROM votes WHERE category_id = ?', [
                categoryId
            ]);
            if (countRow && Number(countRow.n || 0) > 0) {
                return res.status(400).json({ error: 'Cannot delete a category that already has votes' });
            }

            await dbRun('DELETE FROM categories WHERE id = ? AND election_id = ?', [
                categoryId,
                electionId
            ]);
            res.json({ message: 'Category deleted' });
        } catch {
            res.status(500).json({ error: 'Failed to delete category' });
        }
    })();
});

app.get('/api/elections/:id/candidates', (req, res) => {
    const electionId = req.params.id;
    (async () => {
        try {
            const candidates = await dbAll(
                `SELECT c.*, cat.name AS category_name
                 FROM candidates c
                 LEFT JOIN categories cat ON cat.id = c.category_id
                 WHERE c.election_id = ?
                 ORDER BY cat.sort_order ASC, cat.id ASC, c.id ASC`,
                [electionId]
            );
            res.json(candidates || []);
        } catch {
            res.status(500).json({ error: 'Failed to load candidates' });
        }
    })();
});

app.get('/api/categories/:categoryId/candidates', (req, res) => {
    const categoryId = req.params.categoryId;
    (async () => {
        try {
            const rows = await dbAll('SELECT * FROM candidates WHERE category_id = ? ORDER BY id ASC', [
                categoryId
            ]);
            res.json(rows || []);
        } catch {
            res.status(500).json({ error: 'Failed to load nominees' });
        }
    })();
});

app.post('/api/categories/:categoryId/candidates', isAuthenticated, isAdmin, (req, res) => {
    const categoryId = req.params.categoryId;
    const { name, description, image_url } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Nominee name is required' });
    }

    (async () => {
        try {
            const cat = await dbGet('SELECT election_id FROM categories WHERE id = ?', [categoryId]);
            if (!cat) {
                return res.status(404).json({ error: 'Category not found' });
            }
            const r = await dbRun(
                'INSERT INTO candidates (election_id, category_id, name, description, image_url) VALUES (?, ?, ?, ?, ?)',
                [cat.election_id, categoryId, String(name).trim(), description || null, image_url || null]
            );
            res.status(201).json({ message: 'Nominee added', candidateId: r.lastID });
        } catch {
            res.status(500).json({ error: 'Failed to add nominee' });
        }
    })();
});

app.delete('/api/categories/:categoryId/candidates/:candidateId', isAuthenticated, isAdmin, (req, res) => {
    const { categoryId, candidateId } = req.params;
    (async () => {
        try {
            const row = await dbGet('SELECT id FROM candidates WHERE id = ? AND category_id = ?', [
                candidateId,
                categoryId
            ]);
            if (!row) {
                return res.status(404).json({ error: 'Nominee not found' });
            }

            const countRow = await dbGet('SELECT COUNT(*) AS n FROM votes WHERE candidate_id = ?', [
                candidateId
            ]);
            if (countRow && Number(countRow.n || 0) > 0) {
                return res.status(400).json({ error: 'Cannot delete a nominee who has votes' });
            }

            await dbRun('DELETE FROM candidates WHERE id = ? AND category_id = ?', [
                candidateId,
                categoryId
            ]);
            res.json({ message: 'Nominee deleted' });
        } catch {
            res.status(500).json({ error: 'Failed to delete nominee' });
        }
    })();
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
    (async () => {
        try {
            const rows = await dbAll(
                'SELECT election_id, category_id, candidate_id FROM votes WHERE user_id = ?',
                [userId]
            );
            res.json(rows || []);
        } catch {
            res.status(500).json({ error: 'Failed to load vote status' });
        }
    })();
});

app.post('/api/vote/batch', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    const { electionId, selections } = req.body || {};

    if (!electionId || !Array.isArray(selections) || selections.length === 0) {
        return res.status(400).json({ error: 'Select at least one category and nominee' });
    }

    const electionIdNum = parseInt(electionId, 10);

    (async () => {
        try {
            const election = await dbGet('SELECT * FROM elections WHERE id = ?', [electionIdNum]);
            if (!election) {
                return res.status(404).json({ error: 'Election not found' });
            }
            if (!electionAcceptsVotes(election)) {
                return res.status(403).json({ error: 'This election is not open for voting right now' });
            }

            const allCats = await dbAll('SELECT id FROM categories WHERE election_id = ?', [electionIdNum]);
            if (!allCats || allCats.length === 0) {
                return res.status(400).json({ error: 'This election has no categories yet' });
            }

            const catIds = new Set(allCats.map((c) => Number(c.id)));
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
                const ok = await dbGet(
                    `SELECT c.id FROM candidates c
                     INNER JOIN categories cat ON cat.id = c.category_id
                     WHERE c.id = ? AND c.category_id = ? AND cat.election_id = ?`,
                    [row.candidateId, row.categoryId, electionIdNum]
                );
                if (!ok) {
                    return res.status(400).json({ error: 'Nominee is not valid for that category' });
                }
            }

            for (const row of normalized) {
                const existing = await dbGet('SELECT id FROM votes WHERE user_id = ? AND category_id = ?', [
                    userId,
                    row.categoryId
                ]);
                if (existing) {
                    return res.status(400).json({ error: 'You already voted in one of the selected categories' });
                }
            }

            await dbRun('BEGIN');
            try {
                for (const row of normalized) {
                    await dbRun(
                        'INSERT INTO votes (user_id, election_id, category_id, candidate_id) VALUES (?, ?, ?, ?)',
                        [userId, electionIdNum, row.categoryId, row.candidateId]
                    );
                }
                await dbRun('COMMIT');
                res.json({ message: 'Your votes have been saved' });
            } catch (insErr) {
                await dbRun('ROLLBACK');
                if (insErr && (insErr.code === 'SQLITE_CONSTRAINT' || insErr.code === 'SQLITE_CONSTRAINT_UNIQUE')) {
                    return res.status(400).json({ error: 'You have already voted in this category' });
                }
                return res.status(500).json({ error: 'Failed to save votes' });
            }
        } catch {
            res.status(500).json({ error: 'Failed to save votes' });
        }
    })();
});

/**
 * Vote counts: each INSERT into `votes` is one choice (one user, one category, one nominee).
 * Results sum COUNT(votes) per candidate within each category (see SQL below).
 */
app.get('/api/elections/:id/results', (req, res) => {
    const electionId = req.params.id;
    (async () => {
        try {
            const categories = await dbAll(
                'SELECT * FROM categories WHERE election_id = ? ORDER BY sort_order ASC, id ASC',
                [electionId]
            );
            if (!categories || categories.length === 0) {
                return res.json({ categories: [] });
            }

            const blocks = [];
            for (const cat of categories) {
                const results = await dbAll(
                    `
                    SELECT c.id, c.name, c.description, CAST(COUNT(v.id) AS INTEGER) AS vote_count
                    FROM candidates c
                    LEFT JOIN votes v ON v.candidate_id = c.id AND v.category_id = c.category_id
                    WHERE c.category_id = ?
                    GROUP BY c.id, c.name, c.description
                    ORDER BY vote_count DESC, c.name ASC
                    `,
                    [cat.id]
                );
                blocks.push({
                    id: cat.id,
                    name: cat.name,
                    description: cat.description,
                    candidates: results || []
                });
            }
            res.json({ categories: blocks });
        } catch {
            res.status(500).json({ error: 'Failed to load results' });
        }
    })();
});

app.put('/api/elections/:id/toggle', isAuthenticated, isAdmin, (req, res) => {
    const electionId = req.params.id;
    (async () => {
        try {
            const row = await dbGet('SELECT is_active FROM elections WHERE id = ? LIMIT 1', [electionId]);
            if (!row) {
                return res.status(404).json({ error: 'Election not found' });
            }
            const next = row.is_active ? 0 : 1;
            const r = await dbRun('UPDATE elections SET is_active = ? WHERE id = ?', [next, electionId]);
            if ((r.changes || 0) === 0) {
                return res.status(404).json({ error: 'Election not found' });
            }
            res.json({ message: 'Election status updated' });
        } catch {
            res.status(500).json({ error: 'Failed to update election status' });
        }
    })();
});

app.get('/api/admin/stats', isAuthenticated, isAdmin, (req, res) => {
    (async () => {
        try {
            const row = await dbGet(
                `SELECT
                    (SELECT COUNT(*) FROM elections) AS total_elections,
                    (SELECT COUNT(*) FROM elections WHERE is_active = 1) AS active_elections,
                    (SELECT COUNT(*) FROM categories) AS total_categories,
                    (SELECT COUNT(*) FROM candidates) AS total_candidates,
                    (SELECT COUNT(*) FROM votes) AS total_votes`
            );
            if (!row) {
                return res.status(500).json({ error: 'Failed to load statistics' });
            }
            res.json({
                totalElections: Number(row.total_elections || 0),
                activeElections: Number(row.active_elections || 0),
                totalCategories: Number(row.total_categories || 0),
                totalCandidates: Number(row.total_candidates || 0),
                totalVotes: Number(row.total_votes || 0)
            });
        } catch {
            res.status(500).json({ error: 'Failed to load statistics' });
        }
    })();
});

let server;
initDatabase().then(() => {
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(
            `[mfumo] Voting app listening on port ${PORT}${isProduction ? ' (production)' : ' (development)'}`
        );
        console.log(`[mfumo] Open in your browser: http://127.0.0.1:${PORT}/`);
        console.log(`[mfumo] SQLite DB: ${DB_PATH}`);
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
});
