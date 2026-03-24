import express from 'express';
import { poolPromise } from '../config/db.js';

const router = express.Router();

// Generic GET (Select)
router.get('/:table', async (req, res) => {
    const { table } = req.params;
    const { single, ...query } = req.query;
    const pool = await poolPromise;
    
    try {
        let sqlQuery = `SELECT * FROM ${table}`;
        const params = [];
        
        const conditions = Object.entries(query).map(([key, value]) => {
            params.push(value);
            return `${key} = ?`;
        });
        
        if (conditions.length > 0) {
            sqlQuery += ` WHERE ${conditions.join(' AND ')}`;
        }

        if (single) {
            sqlQuery += " LIMIT 1";
        }
        
        const [rows] = await pool.query(sqlQuery, params);
        res.json(single ? rows[0] : rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generic POST (Insert)
router.post('/:table', async (req, res) => {
    const { table } = req.params;
    const data = req.body;
    const pool = await poolPromise;
    
    try {
        const columns = Object.keys(data).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const values = Object.values(data);
        
        const sqlQuery = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
        await pool.query(sqlQuery, values);
        
        // Return the inserted row (MySQL specific)
        const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = LAST_INSERT_ID()`);
        res.json(rows[0] || data); // fallback to data if LAST_INSERT_ID doesn't give what we want for UUIDs
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generic PATCH (Update)
router.patch('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    const data = req.body;
    const pool = await poolPromise;
    
    try {
        const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), id];
        
        const sqlQuery = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
        await pool.query(sqlQuery, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generic DELETE
router.delete('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    const pool = await poolPromise;
    
    try {
        await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RPC Mock (Handle has_role etc.)
router.post('/rpc/:name', async (req, res) => {
    const { name } = req.params;
    const params = req.body;
    // Implement specific RPC logic or mock it
    res.json({ data: true }); // Default to true for has_role etc.
});

export default router;
