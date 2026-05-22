const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  createApprovalChain,
  getApprovalChains,
  updateApprovalChain,
  createApprovalRequest,
  getApprovalRequests,
  approveRequest,
  rejectRequest,
  createDelegation,
  getDelegations,
} = require('../controllers/workflowController');

router.post('/chains', verifyToken, requirePermission('settings', 'create'), createApprovalChain);
router.get('/chains', verifyToken, getApprovalChains);
router.patch('/chains/:id', verifyToken, requirePermission('settings', 'update'), updateApprovalChain);

router.post('/requests', verifyToken, createApprovalRequest);
router.get('/requests', verifyToken, getApprovalRequests);
router.post('/requests/:id/approve', verifyToken, approveRequest);
router.post('/requests/:id/reject', verifyToken, rejectRequest);

router.post('/delegations', verifyToken, createDelegation);
router.get('/delegations', verifyToken, getDelegations);

module.exports = router;