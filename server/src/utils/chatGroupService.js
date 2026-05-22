const ALL_MEMBERS_GROUP_NAME = 'All Members';

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const isReservedSystemGroupName = (groupName) =>
    normalizeName(groupName) === normalizeName(ALL_MEMBERS_GROUP_NAME);

const ensureAllMembersGroup = async (queryable, companyId = null) => {
    const existingRes = await queryable.query(
        `SELECT id
         FROM chat_groups
         WHERE LOWER(name) = LOWER($1)
           AND (
                ($2::uuid IS NULL AND company_id IS NULL)
                OR company_id = $2::uuid
           )
         ORDER BY id ASC
         LIMIT 1`,
        [ALL_MEMBERS_GROUP_NAME, companyId]
    );

    let groupId = existingRes.rows[0]?.id;
    if (!groupId) {
        const insertRes = await queryable.query(
            'INSERT INTO chat_groups (name, created_by, company_id) VALUES ($1, NULL, $2::uuid) RETURNING id',
            [ALL_MEMBERS_GROUP_NAME, companyId]
        );
        groupId = insertRes.rows[0].id;
    }

    await queryable.query(
        `INSERT INTO chat_group_members (group_id, user_id)
         SELECT $1, u.id
         FROM users u
         WHERE (
                ($2::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $2::uuid
         )
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, companyId]
    );

    return groupId;
};

module.exports = {
    ALL_MEMBERS_GROUP_NAME,
    isReservedSystemGroupName,
    ensureAllMembersGroup
};
