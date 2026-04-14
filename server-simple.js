const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';

// Simple in-memory database for demo (replace with SQLite later)
const users = [];
const elections = [
    {
        id: 1,
        title: 'Uchaguzi wa Mwenyekiti wa Chama',
        description: 'Uchaguzi wa kumchagua mwenyekiti mpya wa chama',
        start_date: '2026-04-12',
        end_date: '2026-04-15',
        is_active: true,
        created_at: new Date().toISOString()
    }
];
const candidates = [
    {
        id: 1,
        election_id: 1,
        name: 'John Smith',
        description: 'Mwenye uzoefu wa miaka 10 katika uongozi',
        image_url: 'https://picsum.photos/seed/john/80/80.jpg'
    },
    {
        id: 2,
        election_id: 1,
        name: 'Mary Johnson',
        description: 'Mtaalamu wa mipango na maendeleo',
        image_url: 'https://picsum.photos/seed/mary/80/80.jpg'
    },
    {
        id: 3,
        election_id: 1,
        name: 'David Wilson',
        description: 'Mchumi na mtaalamu wa fedha',
        image_url: 'https://picsum.photos/seed/david/80/80.jpg'
    }
];
const votes = [];

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
}

// Middleware to check if user is admin
function isAdmin(req, res, next) {
    if (req.session.role === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Access denied' });
}

// Routes
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

// API Routes

// User Registration
app.post('/api/register', async (req, res) => {
    const { username, email, password, role = 'voter' } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Check if user already exists
        if (users.find(u => u.username === username || u.email === email)) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const newUser = {
            id: users.length + 1,
            username,
            email,
            password: hashedPassword,
            role,
            created_at: new Date().toISOString()
        };
        
        users.push(newUser);
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err || !isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        
        res.json({ 
            message: 'Login successful',
            user: { id: user.id, username: user.username, role: user.role }
        });
    });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

// Get all elections
app.get('/api/elections', (req, res) => {
    res.json(elections);
});

// Get active elections
app.get('/api/elections/active', (req, res) => {
    res.json(elections.filter(e => e.is_active));
});

// Create election (admin only)
app.post('/api/elections', isAuthenticated, isAdmin, (req, res) => {
    const { title, description, start_date, end_date } = req.body;
    
    const newElection = {
        id: elections.length + 1,
        title,
        description,
        start_date,
        end_date,
        is_active: false,
        created_at: new Date().toISOString()
    };
    
    elections.push(newElection);
    res.status(201).json({ message: 'Election created successfully', electionId: newElection.id });
});

// Get candidates for an election
app.get('/api/elections/:id/candidates', (req, res) => {
    const electionId = parseInt(req.params.id);
    const electionCandidates = candidates.filter(c => c.election_id === electionId);
    res.json(electionCandidates);
});

// Add candidate to election (admin only)
app.post('/api/elections/:id/candidates', isAuthenticated, isAdmin, (req, res) => {
    const electionId = parseInt(req.params.id);
    const { name, description, image_url } = req.body;
    
    const newCandidate = {
        id: candidates.length + 1,
        election_id: electionId,
        name,
        description,
        image_url
    };
    
    candidates.push(newCandidate);
    res.status(201).json({ message: 'Candidate added successfully', candidateId: newCandidate.id });
});

// Submit vote
app.post('/api/vote', isAuthenticated, (req, res) => {
    const { electionId, candidateId } = req.body;
    const userId = req.session.userId;
    
    // Check if user has already voted in this election
    const existingVote = votes.find(v => v.user_id === userId && v.election_id === electionId);
    
    if (existingVote) {
        return res.status(400).json({ error: 'Umeshato kura katika uchaguzi huu' });
    }
    
    // Record the vote
    const newVote = {
        id: votes.length + 1,
        user_id: userId,
        election_id: electionId,
        candidate_id: candidateId,
        voted_at: new Date().toISOString()
    };
    
    votes.push(newVote);
    res.json({ message: 'Kura yako imekamilishwa' });
});

// Get election results
app.get('/api/elections/:id/results', (req, res) => {
    const electionId = parseInt(req.params.id);
    
    const results = candidates
        .filter(c => c.election_id === electionId)
        .map(candidate => {
            const voteCount = votes.filter(v => v.candidate_id === candidate.id).length;
            return {
                id: candidate.id,
                name: candidate.name,
                description: candidate.description,
                vote_count: voteCount
            };
        })
        .sort((a, b) => b.vote_count - a.vote_count);
    
    res.json(results);
});

// Toggle election active status (admin only)
app.put('/api/elections/:id/toggle', isAuthenticated, isAdmin, (req, res) => {
    const electionId = parseInt(req.params.id);
    const election = elections.find(e => e.id === electionId);
    
    if (election) {
        election.is_active = !election.is_active;
        res.json({ message: 'Election status updated successfully' });
    } else {
        res.status(404).json({ error: 'Election not found' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Mfumo wa Uchaguzi unafanya kazi kwenye port ${PORT}`);
    console.log(`Fungua http://localhost:${PORT} kwenye kivinjari chako`);
});
