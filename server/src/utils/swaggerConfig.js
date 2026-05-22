/**
 * Swagger Configuration
 * API Documentation for Track AI Employee Management System
 * @module swagger
 * @description Generates OpenAPI 3.0 documentation from JSDoc annotations
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Track AI API',
      version: '1.0.0',
      description: `
## Track AI - Employee Management System API

### Authentication
All endpoints (except /auth/*) require a Bearer token in the Authorization header.

### Rate Limiting
- Auth endpoints: 5 requests per 15 minutes
- API endpoints: 100 requests per 15 minutes

### Response Format
All responses follow this structure:
\`\`\`json
{
  "data": { ... },
  "message": "Success"
}
\`\`\`

### Error Responses
\`\`\`json
{
  "error": "Error message",
  "details": []
}
\`\`\`
      `,
      contact: {
        name: 'Track AI Support',
        email: 'support@trackai.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server'
      },
      {
        url: 'https://api.trackai.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token from /api/auth/login'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'string' } }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            full_name: { type: 'string' },
            role: { type: 'string', enum: ['EMPLOYEE', 'PROJECT_MANAGER', 'COMPANY_ADMIN', 'SUPERADMIN'] },
            department: { type: 'string' },
            is_active: { type: 'boolean' }
          }
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['active', 'completed', 'archived'] },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            due_date: { type: 'string', format: 'date' }
          }
        },
        Leave: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            leave_type: { type: 'string', enum: ['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid', 'other'] },
            start_date: { type: 'string', format: 'date' },
            end_date: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
            reason: { type: 'string' }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string', format: 'password' }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/User' }
          }
        }
      }
    },
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management endpoints' },
      { name: 'Projects', description: 'Project management endpoints' },
      { name: 'Tasks', description: 'Task management endpoints' },
      { name: 'Leaves', description: 'Leave management endpoints' },
      { name: 'Attendance', description: 'Attendance tracking endpoints' },
      { name: 'Admin', description: 'Admin management endpoints' },
      { name: 'Settings', description: 'Settings and configuration' }
    ]
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

function setupSwagger(app) {
  if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_SWAGGER) {
    return;
  }

  const swaggerOptions = {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { font-size: 2.5em }
      .swagger-ui .info .description { font-size: 1.1em }
    `,
    customSiteTitle: 'Track AI API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true
    }
  };

  if (process.env.SWAGGER_USERNAME && process.env.SWAGGER_PASSWORD) {
    const swaggerAuth = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Swagger Docs"');
        return res.status(401).send('Authentication required');
      }
      const [scheme, credentials] = authHeader.split(' ');
      const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');
      if (username === process.env.SWAGGER_USERNAME && password === process.env.SWAGGER_PASSWORD) {
        return next();
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="Swagger Docs"');
      return res.status(401).send('Invalid credentials');
    };

    app.get('/api-docs.json', swaggerAuth, (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    app.use('/api-docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerOptions));
  } else {
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerOptions));
  }

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER) {
    console.log('📚 Swagger documentation available at /api-docs');
  }
}

module.exports = {
  swaggerSpec,
  setupSwagger
};
