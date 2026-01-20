const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite'
});

const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'WORKER' }
});

async function check() {
    const users = await User.findAll();
    console.log('--- USER REGISTRY ---');
    users.forEach(u => {
        console.log(`ID: ${u.id} | User: ${u.username} | Role: ${u.role}`);
    });
    process.exit();
}

check();
