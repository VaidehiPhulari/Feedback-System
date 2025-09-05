// server.js - Complete Backend API for Feedback System
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Database connection configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'your_password',
    database: process.env.DB_NAME || 'feedback_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Database connected successfully');
        connection.release();
    } catch (error) {
        console.error('Database connection failed:', error);
    }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Routes

// 1. Submit Feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { name, email, feedback_type, subject_course, overall_rating, detailed_feedback } = req.body;

        // Validation
        if (!name || !email || !feedback_type || !overall_rating) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (overall_rating < 1 || overall_rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        const query = `
            INSERT INTO feedback (name, email, feedback_type, subject_course, overall_rating, detailed_feedback)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await pool.execute(query, [
            name, email, feedback_type, subject_course || null, overall_rating, detailed_feedback || null
        ]);

        res.status(201).json({
            message: 'Feedback submitted successfully',
            id: result.insertId
        });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Get All Feedback (with optional filters)
app.get('/api/feedback', async (req, res) => {
    try {
        const { type, rating, limit = 50, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM feedback WHERE 1=1';
        const params = [];

        if (type) {
            query += ' AND feedback_type = ?';
            params.push(type);
        }

        if (rating) {
            query += ' AND overall_rating = ?';
            params.push(parseInt(rating));
        }

        query += ' ORDER BY submission_date DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [rows] = await pool.execute(query, params);
        
        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM feedback WHERE 1=1';
        const countParams = [];
        
        if (type) {
            countQuery += ' AND feedback_type = ?';
            countParams.push(type);
        }
        if (rating) {
            countQuery += ' AND overall_rating = ?';
            countParams.push(parseInt(rating));
        }

        const [countResult] = await pool.execute(countQuery, countParams);
        
        res.json({
            feedback: rows,
            total: countResult[0].total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. Get Feedback by ID
app.get('/api/feedback/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = 'SELECT * FROM feedback WHERE id = ?';
        const [rows] = await pool.execute(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. Update Feedback
app.put('/api/feedback/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, feedback_type, subject_course, overall_rating, detailed_feedback } = req.body;

        const query = `
            UPDATE feedback 
            SET name = ?, email = ?, feedback_type = ?, subject_course = ?, 
                overall_rating = ?, detailed_feedback = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        const [result] = await pool.execute(query, [
            name, email, feedback_type, subject_course, overall_rating, detailed_feedback, id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        res.json({ message: 'Feedback updated successfully' });
    } catch (error) {
        console.error('Error updating feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Delete Feedback
app.delete('/api/feedback/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const query = 'DELETE FROM feedback WHERE id = ?';
        const [result] = await pool.execute(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        res.json({ message: 'Feedback deleted successfully' });
    } catch (error) {
        console.error('Error deleting feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. Analytics Endpoint
app.get('/api/analytics', async (req, res) => {
    try {
        // Total feedback count
        const [totalResult] = await pool.execute('SELECT COUNT(*) as total FROM feedback');
        
        // Average rating
        const [avgResult] = await pool.execute('SELECT AVG(overall_rating) as average FROM feedback');
        
        // Feedback by type
        const [typeResult] = await pool.execute(`
            SELECT feedback_type, COUNT(*) as count, AVG(overall_rating) as avg_rating 
            FROM feedback 
            GROUP BY feedback_type
        `);
        
        // Monthly feedback count
        const [monthlyResult] = await pool.execute(`
            SELECT 
                YEAR(submission_date) as year,
                MONTH(submission_date) as month,
                MONTHNAME(submission_date) as month_name,
                COUNT(*) as count
            FROM feedback 
            WHERE submission_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY YEAR(submission_date), MONTH(submission_date)
            ORDER BY year DESC, month DESC
        `);

        // Rating distribution
        const [ratingResult] = await pool.execute(`
            SELECT overall_rating, COUNT(*) as count 
            FROM feedback 
            GROUP BY overall_rating 
            ORDER BY overall_rating
        `);

        // Recent feedback (last 7 days)
        const [recentResult] = await pool.execute(`
            SELECT COUNT(*) as recent_count 
            FROM feedback 
            WHERE submission_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        res.json({
            total_feedback: totalResult[0].total,
            average_rating: parseFloat(avgResult[0].average || 0).toFixed(1),
            feedback_by_type: typeResult,
            monthly_stats: monthlyResult,
            rating_distribution: ratingResult,
            recent_feedback: recentResult[0].recent_count
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Search Feedback
app.get('/api/search', async (req, res) => {
    try {
        const { q, type, rating } = req.query;
        
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        let query = `
            SELECT * FROM feedback 
            WHERE (detailed_feedback LIKE ? OR subject_course LIKE ? OR name LIKE ?)
        `;
        const searchTerm = `%${q.trim()}%`;
        const params = [searchTerm, searchTerm, searchTerm];

        if (type) {
            query += ' AND feedback_type = ?';
            params.push(type);
        }

        if (rating) {
            query += ' AND overall_rating = ?';
            params.push(parseInt(rating));
        }

        query += ' ORDER BY submission_date DESC LIMIT 50';

        const [rows] = await pool.execute(query, params);
        res.json({ results: rows, count: rows.length });
    } catch (error) {
        console.error('Error searching feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 8. Get Feedback Categories
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM feedback_categories ORDER BY category_name');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await testConnection();
});

module.exports = app;
