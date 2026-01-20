const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite'
});

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'WORKER' }
});

async function setup() {
    await sequelize.sync();
    const existingAdmin = await User.findOne({ where: { username: 'admin' } });
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.create({
            username: 'admin',
            password: hashedPassword,
            role: 'ADMIN'
        });
        console.log('Admin user created: admin / admin123');
    } else {
        console.log('Admin user already exists.');
    }
    process.exit();
}

setup();
