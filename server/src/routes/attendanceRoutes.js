const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { 
  createGeofence,
  getGeofences,
  verifyGeofence,
  createShift,
  getShifts,
  assignShift,
  getEmployeeShift,
  calculateOvertime,
} = require('../controllers/attendanceController');

router.post('/geofences', verifyToken, requirePermission('settings', 'create'), createGeofence);
router.get('/geofences', verifyToken, getGeofences);
router.post('/geofences/verify', verifyToken, verifyGeofence);

router.post('/shifts', verifyToken, requirePermission('settings', 'create'), createShift);
router.get('/shifts', verifyToken, getShifts);
router.post('/shifts/assign', verifyToken, requirePermission('users', 'update'), assignShift);
router.get('/shifts/employee/:employeeId/:date', verifyToken, getEmployeeShift);

router.post('/overtime/calculate/:attendanceId', verifyToken, calculateOvertime);

module.exports = router;