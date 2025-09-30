const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_12345';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dataFilePath = path.join(__dirname, 'data.json');
const uploadsDir = path.join(__dirname, 'uploads');
const adminDir = path.join(__dirname, 'admin');

fs.mkdir(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));
app.use('/admin', express.static(adminDir));
app.get('/', (req, res) => res.redirect('/admin'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const readData = async () => {
    try {
        const data = await fs.readFile(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // إذا الملف مو موجود، إنشاء بيانات افتراضية
        const defaultData = {
            users: [],
            challenges: [],
            rewards: [],
            faq: [],
            submissions: [],
            supportTickets: []
        };
        await writeData(defaultData);
        return defaultData;
    }
};

const writeData = (data) => fs.writeFile(dataFilePath, JSON.stringify(data, null, 2), 'utf8');

// دوال الترجمة
const translateItem = (item, lang) => {
    if (!item) return null;
    const targetLang = lang && lang.startsWith('en') ? 'en' : 'ar';
    const newItem = { ...item };
    for (const key in newItem) {
        if (newItem[key] && typeof newItem[key] === 'object' && newItem[key].ar !== undefined) {
            newItem[key] = newItem[key][targetLang];
        }
    }
    return newItem;
};

const translateContent = (items, lang) => {
    if (!items || !Array.isArray(items)) return [];
    return items.map(item => translateItem(item, lang));
};

const translateUserObject = (user, lang) => {
    if (!user) return null;
    const translatedUser = { ...user };
    if (translatedUser.activeChallenge) {
        translatedUser.activeChallenge = translateItem(translatedUser.activeChallenge, lang);
    }
    return translatedUser;
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- MOBILE APP API ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const data = await readData();
        const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        
        const lang = req.headers['accept-language'];
        const { password: _, ...userFromDb } = user;
        const userToReturn = translateUserObject(userFromDb, lang);

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: 'تم تسجيل الدخول بنجاح', token, user: userToReturn });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'حدث خطأ في السيرفر' });
    }
});

// --- الدالة الجديدة لجلب بيانات المستخدم المحدثة ---
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const lang = req.headers['accept-language'];
        const data = await readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        
        const { password: _, ...userFromDb } = user;
        const userToReturn = translateUserObject(userFromDb, lang);
        res.json(userToReturn);
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/challenges', async (req, res) => {
    const lang = req.headers['accept-language'];
    const data = await readData();
    res.json(translateContent(data.challenges || [], lang));
});

app.get('/api/rewards', async (req, res) => {
    const lang = req.headers['accept-language'];
    const data = await readData();
    res.json(translateContent(data.rewards || [], lang));
});

app.get('/api/faq', async (req, res) => {
    const lang = req.headers['accept-language'];
    const data = await readData();
    res.json(translateContent(data.faq || [], lang));
});

app.post('/api/profile/update', authenticateToken, upload.single('profilePicture'), async (req, res) => {
    try {
        const { username, bio } = req.body;
        const userId = req.user.id;
        const lang = req.headers['accept-language'];
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === userId);
        if (userIndex === -1) return res.status(404).json({ message: 'لم يتم العثور على المستخدم' });

        data.users[userIndex].username = username;
        data.users[userIndex].bio = bio;
        if (req.file) {
            const imageUrl = `${BASE_URL}/uploads/${req.file.filename}`;
            data.users[userIndex].profilePictureUrl = imageUrl;
        }

        await writeData(data);
        const { password: _, ...updatedUserFromDb } = data.users[userIndex];
        const updatedUserToReturn = translateUserObject(updatedUserFromDb, lang);
        res.json({ message: 'تم تحديث الملف الشخصي بنجاح', user: updatedUserToReturn });
    } catch (error) {
        console.error('Profile Update Error:', error);
        res.status(500).json({ message: 'فشل تحديث الملف الشخصي' });
    }
});

app.post('/api/challenges/join', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.body;
        const userId = req.user.id;
        const lang = req.headers['accept-language'];

        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === userId);
        const challenge = data.challenges.find(c => c.id === challengeId);

        if (userIndex === -1 || !challenge) {
            return res.status(404).json({ message: 'User or Challenge not found' });
        }
        
        data.users[userIndex].activeChallenge = { ...challenge, startTime: new Date().toISOString() };
        await writeData(data);
        
        const { password, ...updatedUserFromDb } = data.users[userIndex];
        const updatedUserToReturn = translateUserObject(updatedUserFromDb, lang);
        res.json({ message: 'Challenge started successfully', user: updatedUserToReturn });
    } catch (error) {
        console.error('Join Challenge Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/challenges/cancel', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const lang = req.headers['accept-language'];
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === userId);
        if (userIndex === -1) return res.status(404).json({ message: 'User not found' });
        
        data.users[userIndex].activeChallenge = null;
        await writeData(data);
        
        const { password, ...updatedUserFromDb } = data.users[userIndex];
        const updatedUserToReturn = translateUserObject(updatedUserFromDb, lang);
        res.json({ message: 'Challenge cancelled successfully', user: updatedUserToReturn });
    } catch (error) {
        console.error('Cancel Challenge Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/challenges/submit', authenticateToken, upload.single('completionImage'), async (req, res) => {
    try {
        const { challengeId } = req.body;
        const userId = req.user.id;
        if (!req.file) return res.status(400).json({ message: 'Image proof is required' });

        const data = await readData();
        const user = data.users.find(u => u.id === userId);
        const challenge = data.challenges.find(c => c.id === challengeId);
        if (!user || !challenge) return res.status(404).json({ message: 'User or Challenge not found' });

        const submission = {
            id: uuidv4(),
            userId,
            username: user.username,
            challengeName: challenge.name.ar,
            challenge: challenge,
            imageUrl: `${BASE_URL}/uploads/${req.file.filename}`,
            status: 'pending',
            submittedAt: new Date().toISOString()
        };
        
        if (!data.submissions) data.submissions = [];
        data.submissions.push(submission);
        
        const userIndex = data.users.findIndex(u => u.id === userId);
        if(userIndex !== -1) data.users[userIndex].activeChallenge = null;

        await writeData(data);
        res.json({ message: 'تم رفع الإثبات بنجاح، سيتم التحقق منه قريبًا' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/rewards/redeem', authenticateToken, async (req, res) => {
    try {
        const { rewardId } = req.body;
        const userId = req.user.id;
        const lang = req.headers['accept-language'];
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === userId);
        const reward = data.rewards.find(r => r.id === rewardId);
        if (userIndex === -1 || !reward) return res.status(404).json({ message: 'User or Reward not found' });

        const user = data.users[userIndex];
        if (user.points < reward.cost) return res.status(400).json({ message: 'ليس لديك نقاط كافية' });

        user.points -= reward.cost;
        const redeemedReward = {
            id: reward.id,
            date: new Date().toISOString(),
            qrCodeData: `REWARD-${reward.id}-USER-${userId}-${Date.now()}`
        };
        if (!user.redeemedRewards) user.redeemedRewards = [];
        user.redeemedRewards.push(redeemedReward);

        await writeData(data);
        const { password, ...updatedUserFromDb } = user;
        const updatedUserToReturn = translateUserObject(updatedUserFromDb, lang);
        res.json({ message: 'تم استبدال المكافأة بنجاح', user: updatedUserToReturn });
    } catch (error) {
        console.error('Redeem Reward Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/support/tickets', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const data = await readData();
        const userTickets = (data.supportTickets || [])
            .filter(ticket => ticket.userId === userId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        res.json(userTickets);
    } catch (error) {
        console.error('Get User Tickets Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/support/tickets', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ message: 'Message cannot be empty' });

        const data = await readData();
        const newTicket = {
            id: uuidv4(),
            userId: req.user.id,
            username: req.user.username,
            message: message,
            sender: 'user', 
            status: 'unread',
            createdAt: new Date().toISOString()
        };

        if (!data.supportTickets) data.supportTickets = [];
        data.supportTickets.push(newTicket);
        await writeData(data);

        res.status(201).json({ message: 'Support ticket submitted successfully' });
    } catch (error) {
        console.error('Submit Ticket Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ADMIN PANEL API ---
app.get('/api/admin/submissions', async (req, res) => {
    const data = await readData();
    res.json({
        pending: (data.submissions || []).filter(s => s.status === 'pending'),
        approved: (data.submissions || []).filter(s => s.status === 'approved'),
        rejected: (data.submissions || []).filter(s => s.status === 'rejected')
    });
});

app.post('/api/admin/submissions/:id/approve', async (req, res) => {
    const { id } = req.params;
    const data = await readData();
    const subIndex = data.submissions.findIndex(s => s.id === id);
    if (subIndex === -1) return res.status(404).send('Submission not found');

    const submission = data.submissions[subIndex];
    const challenge = data.challenges.find(c => c.id === submission.challenge.id);
    const userIndex = data.users.findIndex(u => u.id === submission.userId);

    if (submission.status !== 'pending' || !challenge || userIndex === -1) {
        return res.status(400).send('Invalid request');
    }

    submission.status = 'approved';
    submission.processedAt = new Date().toISOString();
    submission.pointsAwarded = challenge.reward;
    data.users[userIndex].points += challenge.reward;
    if (!data.users[userIndex].completedChallenges) data.users[userIndex].completedChallenges = [];
    data.users[userIndex].completedChallenges.push(challenge.id);
    await writeData(data);
    res.sendStatus(200);
});

app.post('/api/admin/submissions/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const data = await readData();
    const subIndex = data.submissions.findIndex(s => s.id === id);
    if (subIndex === -1) return res.status(404).send('Submission not found');
    data.submissions[subIndex].status = 'rejected';
    data.submissions[subIndex].rejectionReason = reason;
    await writeData(data);
    res.sendStatus(200);
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const data = await readData();
        const usersWithTicketCount = data.users.map(user => {
            const unreadCount = (data.supportTickets || []).filter(ticket => 
                ticket.userId === user.id && ticket.status === 'unread' && ticket.sender === 'user'
            ).length;
            const { password, ...userWithoutPassword } = user;
            return { ...userWithoutPassword, unreadMessages: unreadCount };
        });
        res.json(usersWithTicketCount);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const data = await readData();
    const user = data.users.find(u => u.id === id);
    if (!user) return res.status(404).send('User not found');
    const userSubmissions = (data.submissions || []).filter(s => s.userId === id);
    const { password, ...userToReturn } = user;
    res.json({ ...userToReturn, submissions: userSubmissions });
});

app.get('/api/admin/tickets/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const data = await readData();
        const userTickets = (data.supportTickets || [])
            .filter(ticket => ticket.userId === userId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        res.json(userTickets);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/admin/tickets/read', async (req, res) => {
    try {
        const { ticketIds } = req.body;
        if (!ticketIds || !Array.isArray(ticketIds)) return res.status(400).send('Invalid request body');
        
        const data = await readData();
        (data.supportTickets || []).forEach(ticket => {
            if (ticketIds.includes(ticket.id)) {
                ticket.status = 'read';
            }
        });
        await writeData(data);
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/admin/tickets/reply', async (req, res) => {
    try {
        const { userId, message } = req.body;
        if (!userId || !message) return res.status(400).send('Invalid request body');
        
        const data = await readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return res.status(404).send('User not found');

        const replyTicket = {
            id: uuidv4(),
            userId: userId,
            username: user.username,
            message: message,
            sender: 'admin',
            status: 'unread',
            createdAt: new Date().toISOString()
        };

        if (!data.supportTickets) data.supportTickets = [];
        data.supportTickets.push(replyTicket);
        await writeData(data);
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Base URL: ${BASE_URL}`);
});
