const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  createContract, 
  getContracts, 
  addDocument, 
  getDocuments, 
  getExpiringDocuments, 
  generateAttendanceCertificate 
} = require('../controllers/complianceController');

router.post('/contracts', verifyToken, requirePermission('users', 'create'), createContract);
router.get('/contracts', verifyToken, getContracts);

router.post('/documents', verifyToken, requirePermission('users', 'create'), addDocument);
router.get('/documents', verifyToken, getDocuments);
router.get('/documents/expiring', verifyToken, getExpiringDocuments);

router.post('/certificate/attendance', verifyToken, generateAttendanceCertificate);

module.exports = router;