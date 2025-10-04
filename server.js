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
const JWT_SECRET = process.env.JWT_SECRET || 'fitreword2024secret';
const BASE_URL = process.env.BASE_URL || `https://fitreword-backend.onrender.com`;

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

// إعداد multer لرفع الصور
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// قراءة وكتابة البيانات
const readData = async () => {
    try {
        const data = await fs.readFile(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // إذا الملف مو موجود، أنشئ ملف جديد بالبيانات الافتراضية
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

// Middleware للتحقق من الـ token
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        server: 'FitReword Backend'
    });
});

// --- MOBILE APP API ---

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const data = await readData();
        const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيح' });
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيح' });
        
        const lang = req.headers['accept-language'];
        const { password: _, ...userFromDb } = user;
        const userToReturn = translateUserObject(userFromDb, lang);
        
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ user: userToReturn, token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// تسجيل مستخدم جديد
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // التحقق من البيانات المطلوبة
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
        }
        
        // التحقق من طول كلمة المرور
        if (password.length < 6) {
            return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }
        
        const data = await readData();
        
        // التحقق من وجود المستخدم
        const existingUser = data.users.find(u => 
            u.username.toLowerCase() === username.toLowerCase() || 
            u.email.toLowerCase() === email.toLowerCase()
        );
        
        if (existingUser) {
            return res.status(409).json({ message: 'اسم المستخدم أو البريد الإلكتروني موجود بالفعل' });
        }
        
        // تشفير كلمة المرور
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // إنشاء مستخدم جديد
        const newUser = {
            id: uuidv4(),
            username: username.trim(),
            email: email.trim().toLowerCase(),
            password: hashedPassword,
            points: 0,
            profilePictureUrl: null,
            bio: null,
            activeChallenge: null,
            completedChallenges: [],
            redeemedRewards: []
        };
        
        data.users.push(newUser);
        await writeData(data);
        
        // إنشاء token
        const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
        
        // إرجاع بيانات المستخدم بدون كلمة المرور
        const { password: _, ...userToReturn } = newUser;
        
        res.status(201).json({ 
            message: 'تم إنشاء الحساب بنجاح',
            user: userToReturn, 
            token 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على التحديات
app.get('/api/challenges', async (req, res) => {
    try {
        const data = await readData();
        const lang = req.headers['accept-language'];
        const translatedChallenges = translateContent(data.challenges, lang);
        res.json(translatedChallenges);
    } catch (error) {
        console.error('Get challenges error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على المكافآت
app.get('/api/rewards', async (req, res) => {
    try {
        const data = await readData();
        const lang = req.headers['accept-language'];
        const translatedRewards = translateContent(data.rewards, lang);
        res.json(translatedRewards);
    } catch (error) {
        console.error('Get rewards error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على الأسئلة الشائعة
app.get('/api/faq', async (req, res) => {
    try {
        const data = await readData();
        const lang = req.headers['accept-language'];
        const translatedFaq = translateContent(data.faq, lang);
        res.json(translatedFaq);
    } catch (error) {
        console.error('Get FAQ error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على بيانات المستخدم
app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const data = await readData();
        const user = data.users.find(u => u.id === req.user.id);
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const lang = req.headers['accept-language'];
        const { password: _, ...userFromDb } = user;
        const userToReturn = translateUserObject(userFromDb, lang);
        
        res.json(userToReturn);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// تحديث الملف الشخصي
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { bio } = req.body;
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        if (bio !== undefined) {
            data.users[userIndex].bio = bio;
        }
        
        await writeData(data);
        
        const { password: _, ...userToReturn } = data.users[userIndex];
        res.json(userToReturn);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// رفع صورة الملف الشخصي
app.post('/api/user/profile-picture', authenticateToken, upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'لم يتم رفع أي صورة' });
        }
        
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }
        
        // حذف الصورة القديمة إذا كانت موجودة
        const oldPictureUrl = data.users[userIndex].profilePictureUrl;
        if (oldPictureUrl && oldPictureUrl.includes('/uploads/')) {
            const oldFileName = path.basename(oldPictureUrl);
            const oldFilePath = path.join(uploadsDir, oldFileName);
            try {
                await fs.unlink(oldFilePath);
            } catch (err) {
                console.log('Could not delete old profile picture:', err.message);
            }
        }
        
        // تحديث رابط الصورة الجديدة
        const profilePictureUrl = `${BASE_URL}/uploads/${req.file.filename}`;
        data.users[userIndex].profilePictureUrl = profilePictureUrl;
        
        await writeData(data);
        
        res.json({ 
            message: 'تم رفع الصورة بنجاح',
            profilePictureUrl: profilePictureUrl 
        });
        
    } catch (error) {
        console.error('Upload profile picture error:', error);
        res.status(500).json({ message: 'خطأ في رفع الصورة' });
    }
});

// بدء تحدي
app.post('/api/challenges/:challengeId/start', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        const data = await readData();
        
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const challenge = data.challenges.find(c => c.id === challengeId);
        if (!challenge) return res.status(404).json({ message: 'التحدي غير موجود' });
        
        if (data.users[userIndex].activeChallenge) {
            return res.status(400).json({ message: 'لديك تحدي نشط بالفعل' });
        }
        
        data.users[userIndex].activeChallenge = {
            ...challenge,
            startedAt: new Date().toISOString()
        };
        
        await writeData(data);
        
        const lang = req.headers['accept-language'];
        const translatedChallenge = translateItem(data.users[userIndex].activeChallenge, lang);
        
        res.json({ 
            message: 'تم بدء التحدي بنجاح',
            activeChallenge: translatedChallenge 
        });
    } catch (error) {
        console.error('Start challenge error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// إلغاء تحدي
app.post('/api/challenges/cancel', authenticateToken, async (req, res) => {
    try {
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        if (!data.users[userIndex].activeChallenge) {
            return res.status(400).json({ message: 'لا يوجد تحدي نشط' });
        }
        
        data.users[userIndex].activeChallenge = null;
        await writeData(data);
        
        res.json({ message: 'تم إلغاء التحدي بنجاح' });
    } catch (error) {
        console.error('Cancel challenge error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// إرسال طلب إكمال تحدي
app.post('/api/challenges/submit', authenticateToken, upload.single('completionImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'صورة الإثبات مطلوبة' });
        }
        
        const data = await readData();
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        
        if (userIndex === -1) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const user = data.users[userIndex];
        if (!user.activeChallenge) {
            return res.status(400).json({ message: 'لا يوجد تحدي نشط' });
        }
        
        const submission = {
            id: uuidv4(),
            userId: user.id,
            username: user.username,
            challengeName: user.activeChallenge.name?.ar || user.activeChallenge.name,
            challenge: user.activeChallenge,
            imageUrl: `${BASE_URL}/uploads/${req.file.filename}`,
            status: 'pending',
            submittedAt: new Date().toISOString()
        };
        
        data.submissions.push(submission);
        data.users[userIndex].activeChallenge = null;
        
        await writeData(data);
        
        res.json({ 
            message: 'تم إرسال طلب التحقق بنجاح',
            submission: submission 
        });
    } catch (error) {
        console.error('Submit challenge error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// استبدال مكافأة
app.post('/api/rewards/:rewardId/redeem', authenticateToken, async (req, res) => {
    try {
        const { rewardId } = req.params;
        const data = await readData();
        
        const userIndex = data.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const reward = data.rewards.find(r => r.id === rewardId);
        if (!reward) return res.status(404).json({ message: 'المكافأة غير موجودة' });
        
        const user = data.users[userIndex];
        if (user.points < reward.cost) {
            return res.status(400).json({ message: 'نقاطك غير كافية لاستبدال هذه المكافأة' });
        }
        
        const qrCodeData = `REWARD-${rewardId}-USER-${user.id}-${Date.now()}`;
        const redemption = {
            id: rewardId,
            date: new Date().toISOString(),
            qrCodeData: qrCodeData
        };
        
        data.users[userIndex].points -= reward.cost;
        data.users[userIndex].redeemedRewards.push(redemption);
        
        await writeData(data);
        
        res.json({ 
            message: 'تم استبدال المكافأة بنجاح',
            qrCode: qrCodeData,
            remainingPoints: data.users[userIndex].points 
        });
    } catch (error) {
        console.error('Redeem reward error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// إرسال رسالة دعم
app.post('/api/support', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ message: 'الرسالة مطلوبة' });
        }
        
        const data = await readData();
        const user = data.users.find(u => u.id === req.user.id);
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const ticket = {
            id: uuidv4(),
            userId: user.id,
            username: user.username,
            message: message.trim(),
            sender: 'user',
            status: 'unread',
            createdAt: new Date().toISOString()
        };
        
        data.supportTickets.push(ticket);
        await writeData(data);
        
        res.json({ 
            message: 'تم إرسال رسالتك بنجاح',
            ticket: ticket 
        });
    } catch (error) {
        console.error('Support ticket error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// --- ADMIN API ---

// الحصول على جميع الطلبات مجمعة حسب الحالة
app.get('/api/admin/submissions', async (req, res) => {
    try {
        const data = await readData();
        const groupedSubmissions = {
            pending: data.submissions.filter(s => s.status === 'pending'),
            approved: data.submissions.filter(s => s.status === 'approved'),
            rejected: data.submissions.filter(s => s.status === 'rejected')
        };
        res.json(groupedSubmissions);
    } catch (error) {
        console.error('Get admin submissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الموافقة على طلب
app.post('/api/admin/submissions/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readData();
        
        const submissionIndex = data.submissions.findIndex(s => s.id === id);
        if (submissionIndex === -1) return res.status(404).json({ message: 'الطلب غير موجود' });
        
        const submission = data.submissions[submissionIndex];
        const userIndex = data.users.findIndex(u => u.id === submission.userId);
        
        if (userIndex !== -1) {
            data.users[userIndex].points += submission.challenge.reward;
            data.users[userIndex].completedChallenges.push(submission.challenge.id);
        }
        
        data.submissions[submissionIndex].status = 'approved';
        data.submissions[submissionIndex].processedAt = new Date().toISOString();
        data.submissions[submissionIndex].pointsAwarded = submission.challenge.reward;
        
        await writeData(data);
        res.json({ message: 'تمت الموافقة على الطلب' });
    } catch (error) {
        console.error('Approve submission error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// رفض طلب
app.post('/api/admin/submissions/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const data = await readData();
        
        const submissionIndex = data.submissions.findIndex(s => s.id === id);
        if (submissionIndex === -1) return res.status(404).json({ message: 'الطلب غير موجود' });
        
        data.submissions[submissionIndex].status = 'rejected';
        data.submissions[submissionIndex].rejectionReason = reason;
        
        await writeData(data);
        res.json({ message: 'تم رفض الطلب' });
    } catch (error) {
        console.error('Reject submission error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على جميع المستخدمين مع عدد الرسائل غير المقروءة
app.get('/api/admin/users', async (req, res) => {
    try {
        const data = await readData();
        const usersWithUnreadCount = data.users.map(user => {
            const unreadMessages = data.supportTickets.filter(
                ticket => ticket.userId === user.id && ticket.status === 'unread' && ticket.sender === 'user'
            ).length;
            
            const { password: _, ...userWithoutPassword } = user;
            return {
                ...userWithoutPassword,
                unreadMessages
            };
        });
        
        res.json(usersWithUnreadCount);
    } catch (error) {
        console.error('Get admin users error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على تفاصيل مستخدم محدد
app.get('/api/admin/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const data = await readData();
        
        const user = data.users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const userSubmissions = data.submissions.filter(s => s.userId === userId);
        const { password: _, ...userWithoutPassword } = user;
        
        res.json({
            ...userWithoutPassword,
            submissions: userSubmissions
        });
    } catch (error) {
        console.error('Get admin user details error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الحصول على رسائل الدعم لمستخدم محدد
app.get('/api/admin/tickets/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const data = await readData();
        
        const userTickets = data.supportTickets
            .filter(ticket => ticket.userId === userId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        
        res.json(userTickets);
    } catch (error) {
        console.error('Get user tickets error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// الرد على رسالة دعم
app.post('/api/admin/tickets/reply', async (req, res) => {
    try {
        const { userId, message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ message: 'الرسالة مطلوبة' });
        }
        
        const data = await readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        const replyTicket = {
            id: uuidv4(),
            userId: userId,
            username: 'Admin',
            message: message.trim(),
            sender: 'admin',
            status: 'read',
            createdAt: new Date().toISOString()
        };
        
        data.supportTickets.push(replyTicket);
        await writeData(data);
        
        res.json({ message: 'تم إرسال الرد بنجاح' });
    } catch (error) {
        console.error('Reply to ticket error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// تحديد الرسائل كمقروءة
app.post('/api/admin/tickets/read', async (req, res) => {
    try {
        const { ticketIds } = req.body;
        const data = await readData();
        
        ticketIds.forEach(ticketId => {
            const ticketIndex = data.supportTickets.findIndex(t => t.id === ticketId);
            if (ticketIndex !== -1) {
                data.supportTickets[ticketIndex].status = 'read';
            }
        });
        
        await writeData(data);
        res.json({ message: 'تم تحديث حالة الرسائل' });
    } catch (error) {
        console.error('Mark tickets as read error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Health check: ${BASE_URL}/health`);
    console.log(`👨‍💼 Admin panel: ${BASE_URL}/admin`);
});
