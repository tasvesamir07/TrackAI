const { Sequelize, DataTypes } = require('sequelize');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mandatory for Vercel: Force bundling of PostgreSQL driver
try {
    require('pg');
    require('pg-hstore');
} catch (e) { }

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const sequelize = process.env.DATABASE_URL
    ? new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        protocol: 'postgres',
        dialectModule: require('pg'), // Critical fix for Vercel
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
    })
    : new Sequelize({
        dialect: 'sqlite',
        storage: '/tmp/database.sqlite',
        dialectModule: require('sqlite3')
    });

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'WORKER' }
});

const WorkLog = sequelize.define('WorkLog', {
    date: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    planForTomorrow: { type: DataTypes.TEXT, allowNull: false }
});

User.hasMany(WorkLog);
WorkLog.belongsTo(User);

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Routes
app.post('/api/auth/register', authenticateToken, async (req, res) => {
    if (req.user.role !== 'ADMIN') return res.sendStatus(403);
    try {
        const { username, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ username, password: hashedPassword, role: role || 'WORKER' });
        res.status(201).json({ message: 'User created' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });
        if (!user) return res.status(400).json({ error: 'User not found' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET);
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'ADMIN') return res.sendStatus(403);
    const users = await User.findAll({ attributes: ['id', 'username', 'role', 'createdAt'] });
    res.json(users);
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'ADMIN') return res.sendStatus(403);
    const user = await User.findByPk(req.params.id);
    if (user && user.role === 'ADMIN') {
        return res.status(400).json({ error: 'Cannot delete admin accounts' });
    }
    await User.destroy({ where: { id: req.params.id } });
    res.json({ message: 'User deleted' });
});

app.post('/api/work-logs', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const { description, planForTomorrow } = req.body;

        let log = await WorkLog.findOne({
            where: { UserId: req.user.id, date: today }
        });

        if (log) {
            log.description = description;
            log.planForTomorrow = planForTomorrow;
            await log.save();
            return res.status(200).json(log);
        } else {
            log = await WorkLog.create({
                UserId: req.user.id,
                date: today,
                description,
                planForTomorrow
            });
            return res.status(201).json(log);
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/work-logs', authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;
        const where = {};
        if (date) where.date = date;
        if (req.user.role !== 'ADMIN') where.UserId = req.user.id;

        const logs = await WorkLog.findAll({
            where,
            include: [{ model: User, attributes: ['username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/work-logs/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'ADMIN') return res.sendStatus(403);
    try {
        await WorkLog.destroy({ where: { id: req.params.id } });
        res.json({ message: 'Work log deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const startServer = async () => {
    try {
        await sequelize.sync();
        console.log('Database synced');
    } catch (err) {
        console.error('Failed to sync database:', err);
    }
};

startServer();

module.exports = app;
