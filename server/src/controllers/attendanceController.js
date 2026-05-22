const db = require('../db');

const createGeofence = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { name, latitude, longitude, radiusMeters } = req.body;

    const { rows } = await db.query(
      `INSERT INTO geofences (company_id, name, latitude, longitude, radius_meters, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [companyId, name, latitude, longitude, radiusMeters, userId]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Create geofence error:', error);
    return res.status(500).json({ error: 'Failed to create geofence' });
  }
};

const getGeofences = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM geofences WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get geofences error:', error);
    return res.status(500).json({ error: 'Failed to get geofences' });
  }
};

const verifyGeofence = async (req, res) => {
  try {
    const { latitude, longitude, geofenceId } = req.body;

    const { rows: geofences } = await db.query(
      `SELECT * FROM geofences WHERE id = $1`,
      [geofenceId]
    );

    if (!geofences.length) {
      return res.status(400).json({ error: 'Geofence not found' });
    }

    const geo = geofences[0];
    const distance = calculateDistance(latitude, longitude, geo.latitude, geo.longitude);
    const isWithin = distance <= geo.radius_meters;

    return res.json({
      data: {
        isWithin,
        distance: Math.round(distance),
        geofenceName: geo.name,
      }
    });
  } catch (error) {
    console.error('Verify geofence error:', error);
    return res.status(500).json({ error: 'Failed to verify geofence' });
  }
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

const createShift = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { name, startTime, endTime, graceMinutes, breakStart, breakEnd, isNightShift } = req.body;

    const { rows } = await db.query(
      `INSERT INTO shifts (company_id, name, start_time, end_time, grace_minutes, break_start, break_end, is_night_shift)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [companyId, name, startTime, endTime, graceMinutes || 5, breakStart, breakEnd, isNightShift || false]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Create shift error:', error);
    return res.status(500).json({ error: 'Failed to create shift' });
  }
};

const getShifts = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT * FROM shifts WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get shifts error:', error);
    return res.status(500).json({ error: 'Failed to get shifts' });
  }
};

const assignShift = async (req, res) => {
  try {
    const { employeeId, shiftId, effectiveFrom, effectiveTo } = req.body;

    const { rows } = await db.query(
      `INSERT INTO shift_assignments (employee_id, shift_id, effective_from, effective_to)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [employeeId, shiftId, effectiveFrom, effectiveTo]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Assign shift error:', error);
    return res.status(500).json({ error: 'Failed to assign shift' });
  }
};

const getEmployeeShift = async (req, res) => {
  try {
    const { employeeId, date } = req.params;

    const { rows } = await db.query(
      `SELECT s.* FROM shifts s
       JOIN shift_assignments sa ON s.id = sa.shift_id
       WHERE sa.employee_id = $1 
       AND sa.effective_from <= $2 
       AND (sa.effective_to IS NULL OR sa.effective_to >= $2)
       LIMIT 1`,
      [employeeId, date]
    );

    return res.json({ data: rows[0] || null });
  } catch (error) {
    console.error('Get employee shift error:', error);
    return res.status(500).json({ error: 'Failed to get employee shift' });
  }
};

const calculateOvertime = async (req, res) => {
  try {
    const { attendanceId } = req.params;

    const { rows: attendance } = await db.query(
      `SELECT a.*, s.start_time as shift_start, s.end_time as shift_end 
       FROM attendance a
       LEFT JOIN shifts s ON a.shift_id = s.id
       WHERE a.id = $1`,
      [attendanceId]
    );

    if (!attendance.length) {
      return res.status(400).json({ error: 'Attendance not found' });
    }

    const att = attendance[0];
    const workStart = att.shift_start || '09:00';
    const workEnd = att.shift_end || '17:00';
    
    const checkInTime = new Date(att.check_in).getHours() * 60 + new Date(att.check_in).getMinutes();
    const checkOutTime = new Date(att.check_out).getHours() * 60 + new Date(att.check_out).getMinutes();
    
    const expectedStart = parseInt(workStart.split(':')[0]) * 60 + parseInt(workStart.split(':')[1]);
    const expectedEnd = parseInt(workEnd.split(':')[0]) * 60 + parseInt(workEnd.split(':')[1]);
    
    const workMinutes = checkOutTime - checkInTime - (att.break_duration_minutes || 0);
    const expectedMinutes = expectedEnd - expectedStart;
    
    const overtime = Math.max(0, workMinutes - expectedMinutes);

    await db.query(
      `UPDATE attendance SET overtime_minutes = $1 WHERE id = $2`,
      [overtime, attendanceId]
    );

    return res.json({ data: { overtimeMinutes: overtime } });
  } catch (error) {
    console.error('Calculate overtime error:', error);
    return res.status(500).json({ error: 'Failed to calculate overtime' });
  }
};

module.exports = {
  createGeofence,
  getGeofences,
  verifyGeofence,
  createShift,
  getShifts,
  assignShift,
  getEmployeeShift,
  calculateOvertime,
};