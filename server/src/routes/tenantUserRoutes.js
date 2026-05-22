const express = require('express');
const { createCompanyUser } = require('../controllers/tenantUserController');
const {
    attachCompanyContext,
    enforceLimits,
    requireCompanyAdminOrSuperadmin
} = require('../middleware/tenantMiddleware');

const router = express.Router();

router.post(
    '/users',
    attachCompanyContext,
    requireCompanyAdminOrSuperadmin,
    enforceLimits((req) => req.body?.role),
    createCompanyUser
);

module.exports = router;
