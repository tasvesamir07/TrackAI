const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { searchAll } = require('../controllers/searchController');

router.get('/', verifyToken, searchAll);

module.exports = router;