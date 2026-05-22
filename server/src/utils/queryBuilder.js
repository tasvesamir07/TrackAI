const db = require('../db');

class QueryBuilder {
  constructor() {
    this.queries = [];
    this.results = new Map();
  }

  add(key, query, params = []) {
    this.queries.push({ key, query, params });
    return this;
  }

  async execute() {
    for (const { key, query, params } of this.queries) {
      try {
        const result = await db.query(query, params);
        this.results.set(key, result.rows);
      } catch (error) {
        console.error(`[QueryBuilder] Error executing query for "${key}":`, error.message);
        this.results.set(key, []);
      }
    }
    return this.results;
  }

  get(key) {
    return this.results.get(key) || [];
  }

  async executeParallel() {
    const promises = this.queries.map(async ({ key, query, params }) => {
      try {
        const result = await db.query(query, params);
        return { key, data: result.rows };
      } catch (error) {
        console.error(`[QueryBuilder] Error in parallel query "${key}":`, error.message);
        return { key, data: [] };
      }
    });

    const results = await Promise.all(promises);
    results.forEach(({ key, data }) => this.results.set(key, data));
    return this.results;
  }
}

const queryBuilder = new QueryBuilder();

const batchByIds = async (ids, queryFn, keyName = 'id') => {
  if (!ids || ids.length === 0) return [];
  
  const uniqueIds = [...new Set(ids)];
  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
  const query = queryFn(placeholders);
  
  const result = await db.query(query, uniqueIds);
  return result.rows;
};

const withUserJoin = async (tableName, userIdColumn = 'user_id', extraColumns = '') => {
  return `
    SELECT t.*, 
           u.full_name as user_full_name, 
           u.username as user_username,
           u.email as user_email,
           u.profile_picture as user_profile_picture,
           u.department as user_department
    FROM "${tableName}" t
    LEFT JOIN users u ON t.${userIdColumn} = u.id
  `;
};

const withProjectJoin = async (tableName, projectIdColumn = 'project_id', extraColumns = '') => {
  return `
    SELECT t.*, 
           p.name as project_name,
           p.status as project_status
    FROM "${tableName}" t
    LEFT JOIN "Project" p ON t.${projectIdColumn} = p.id
  `;
};

const withCreatorJoin = async (tableName, createdByColumn = 'created_by', extraColumns = '') => {
  return `
    SELECT t.*, 
           creator.full_name as creator_full_name,
           creator.username as creator_username,
           creator.email as creator_email
    FROM "${tableName}" t
    LEFT JOIN users creator ON t.${createdByColumn} = creator.id
  `;
};

const withAssigneeJoin = async (tableName, assignedByColumn = 'assigned_by', extraColumns = '') => {
  return `
    SELECT t.*, 
           assignee.full_name as assignee_full_name,
           assignee.username as assignee_username,
           assignee.email as assignee_email
    FROM "${tableName}" t
    LEFT JOIN users assignee ON t.${assignedByColumn} = assignee.id
  `;
};

const buildSearchQuery = (baseQuery, searchTerm, searchColumns, extraConditions = '') => {
  if (!searchTerm) {
    return { query: baseQuery + (extraConditions ? ` WHERE 1=1 ${extraConditions}` : ''), params: [] };
  }

  const searchPattern = `%${searchTerm}%`;
  const searchConditions = searchColumns.map((col, i) => `LOWER(${col}) LIKE $${i + 1}`).join(' OR ');
  const params = [...Array(searchColumns.length).fill(searchPattern)];
  
  const whereClause = `WHERE (${searchConditions}) ${extraConditions}`;
  return {
    query: `${baseQuery} ${whereClause}`,
    params
  };
};

const buildPagination = (page = 1, limit = 50) => {
  const offset = (Math.max(1, page) - 1) * Math.min(limit, 100);
  return { offset, limit: Math.min(limit, 100) };
};

const getTotalCount = async (baseQuery, params = []) => {
  const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as counted`;
  const result = await db.query(countQuery, params);
  return parseInt(result.rows[0]?.total || '0', 10);
};

module.exports = {
  QueryBuilder,
  queryBuilder,
  batchByIds,
  withUserJoin,
  withProjectJoin,
  withCreatorJoin,
  withAssigneeJoin,
  buildSearchQuery,
  buildPagination,
  getTotalCount
};