const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { naturalLanguageSearch, generateInsights, detectAnomalies, getRecommendations } = require('../controllers/aiController');

router.post('/search', verifyToken, naturalLanguageSearch);
router.get('/insights', verifyToken, generateInsights);
router.get('/anomalies', verifyToken, detectAnomalies);
router.post('/recommendations', verifyToken, getRecommendations);

module.exports = router;