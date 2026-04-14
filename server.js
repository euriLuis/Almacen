const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initDb = require('./database');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Error logging middleware
app.use((err, req, res, next) => {
    console.error(`❌ Server Error [${req.method} ${req.url}]:`, err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Request logging middleware
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

// Initialize database and start server
async function start() {
    const db = await initDb();

// ==================== API ROUTES ====================

// ===== WAREHOUSES =====
app.get('/api/warehouses', (req, res) => {
    try {
        const warehouses = db.exec('SELECT * FROM warehouses ORDER BY created_at DESC');
        res.json(warehouses.length > 0 ? warehouses[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/warehouses', (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        // Check if warehouse with same name already exists
        const existing = db.exec('SELECT id FROM warehouses WHERE name = ?', [name]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            return res.status(409).json({ error: 'A warehouse with this name already exists' });
        }

        const stmt = db.prepare('INSERT INTO warehouses (name, description) VALUES (?, ?)');
        stmt.run([name, description || '']);
        db.save();

        const result = db.exec('SELECT last_insert_rowid() as id');
        res.status(201).json({ id: result[0].values[0][0], name, description: description || '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/warehouses/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.run('DELETE FROM warehouses WHERE id = ?', [id]);
        db.save();
        res.json({ message: 'Warehouse deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CATEGORIES =====
app.get('/api/warehouses/:warehouseId/categories', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const categories = db.exec(
            'SELECT * FROM categories WHERE warehouse_id = ? ORDER BY created_at DESC',
            [warehouseId]
        );
        res.json(categories.length > 0 ? categories[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/warehouses/:warehouseId/categories', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        
        const stmt = db.prepare('INSERT INTO categories (name, warehouse_id) VALUES (?, ?)');
        stmt.run([name, warehouseId]);
        db.save();
        
        const result = db.exec('SELECT last_insert_rowid() as id');
        res.json({ id: result[0].values[0][0], name, warehouse_id: warehouseId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.run('DELETE FROM categories WHERE id = ?', [id]);
        db.save();
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== PRODUCTS =====
app.get('/api/categories/:categoryId/products', (req, res) => {
    try {
        const { categoryId } = req.params;
        const products = db.exec(
            'SELECT * FROM products WHERE category_id = ? ORDER BY name',
            [categoryId]
        );
        res.json(products.length > 0 ? products[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/warehouses/:warehouseId/products', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const { categoryId } = req.query;
        
        let query = `
            SELECT p.*, c.name as category_name 
            FROM products p 
            JOIN categories c ON p.category_id = c.id 
            WHERE c.warehouse_id = ?
        `;
        const params = [warehouseId];
        
        if (categoryId) {
            query += ' AND p.category_id = ?';
            params.push(categoryId);
        }
        
        query += ' ORDER BY c.name, p.name';
        
        const products = db.exec(query, params);
        res.json(products.length > 0 ? products[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories/:categoryId/products', (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        
        const stmt = db.prepare(
            'INSERT INTO products (name, description, category_id, quantity) VALUES (?, ?, ?, 0)'
        );
        stmt.run([name, description || '', categoryId]);
        db.save();
        
        const result = db.exec('SELECT last_insert_rowid() as id');
        res.json({ 
            id: result[0].values[0][0], 
            name, 
            description: description || '', 
            category_id: categoryId,
            quantity: 0 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.run('DELETE FROM products WHERE id = ?', [id]);
        db.save();
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== MOVEMENTS (Entries/Exits) =====
app.post('/api/movements', (req, res) => {
    try {
        const { movements } = req.body;
        if (!Array.isArray(movements) || movements.length === 0) {
            return res.status(400).json({ error: 'Movements array is required' });
        }
        
        const insertStmt = db.prepare(
            'INSERT INTO movements (product_id, type, quantity, date, notes) VALUES (?, ?, ?, ?, ?)'
        );
        
        const updateStmt = db.prepare(
            'UPDATE products SET quantity = quantity + ? WHERE id = ?'
        );
        
        const today = new Date().toISOString().split('T')[0];
        
        for (const movement of movements) {
            const { productId, type, quantity, notes } = movement;
            
            if (!productId || !type || !quantity) {
                return res.status(400).json({ 
                    error: 'productId, type, and quantity are required for each movement' 
                });
            }
            
            if (type !== 'entry' && type !== 'exit') {
                return res.status(400).json({ error: 'Type must be "entry" or "exit"' });
            }
            
            if (type === 'exit') {
                const product = db.exec('SELECT quantity FROM products WHERE id = ?', [productId]);
                if (product.length > 0 && product[0].values[0][0] < quantity) {
                    return res.status(400).json({ 
                        error: 'Insufficient stock for product' 
                    });
                }
            }
            
            const qty = type === 'entry' ? quantity : -quantity;
            insertStmt.run([productId, type, quantity, today, notes || '']);
            updateStmt.run([qty, productId]);
        }
        
        db.save();
        res.json({ message: 'Movements recorded successfully', count: movements.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== DAILY SUMMARY =====
app.get('/api/summary/daily', (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        const summary = db.exec(`
            SELECT
                p.id as product_id,
                p.name as product_name,
                c.name as category_name,
                w.name as warehouse_name,
                w.id as warehouse_id,
                COALESCE(SUM(CASE WHEN m.type = 'entry' THEN m.quantity ELSE 0 END), 0) as total_entries,
                COALESCE(SUM(CASE WHEN m.type = 'exit' THEN m.quantity ELSE 0 END), 0) as total_exits,
                p.quantity as current_quantity
            FROM movements m
            JOIN products p ON m.product_id = p.id
            JOIN categories c ON p.category_id = c.id
            JOIN warehouses w ON c.warehouse_id = w.id
            WHERE m.date = ?
            GROUP BY p.id
            ORDER BY w.name, c.name, p.name
        `, [targetDate]);

        res.json(summary.length > 0 ? summary[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== WEEKLY SUMMARY =====
app.get('/api/summary/weekly', (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        // Calculate week start (Monday) and end (Sunday)
        const dateObj = new Date(targetDate);
        const dayOfWeek = dateObj.getDay();
        const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        const monday = new Date(dateObj);
        monday.setDate(dateObj.getDate() + diffToMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        
        const startDate = monday.toISOString().split('T')[0];
        const endDate = sunday.toISOString().split('T')[0];

        const summary = db.exec(`
            SELECT
                p.id as product_id,
                p.name as product_name,
                c.name as category_name,
                w.name as warehouse_name,
                w.id as warehouse_id,
                COALESCE(SUM(CASE WHEN m.type = 'entry' THEN m.quantity ELSE 0 END), 0) as total_entries,
                COALESCE(SUM(CASE WHEN m.type = 'exit' THEN m.quantity ELSE 0 END), 0) as total_exits,
                p.quantity as current_quantity
            FROM movements m
            JOIN products p ON m.product_id = p.id
            JOIN categories c ON p.category_id = c.id
            JOIN warehouses w ON c.warehouse_id = w.id
            WHERE m.date >= ? AND m.date <= ?
            GROUP BY p.id
            ORDER BY w.name, c.name, p.name
        `, [startDate, endDate]);

        res.json(summary.length > 0 ? summary[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ALL PRODUCTS WITH STOCK =====
app.get('/api/products', (req, res) => {
    try {
        const { warehouseId, categoryId, search } = req.query;

        let query = `
            SELECT
                p.id,
                p.name,
                p.description,
                p.quantity,
                c.id as category_id,
                c.name as category_name,
                w.id as warehouse_id,
                w.name as warehouse_name
            FROM products p
            JOIN categories c ON p.category_id = c.id
            JOIN warehouses w ON c.warehouse_id = w.id
            WHERE 1=1
        `;
        const params = [];

        if (warehouseId) {
            query += ' AND w.id = ?';
            params.push(warehouseId);
        }

        if (categoryId) {
            query += ' AND c.id = ?';
            params.push(categoryId);
        }

        if (search) {
            query += ' AND p.name LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY w.name, c.name, p.name';

        const products = db.exec(query, params);
        res.json(products.length > 0 ? products[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== RESTORE DELETED WAREHOUSE (undo) =====
app.post('/api/warehouses/restore', (req, res) => {
    try {
        const { id, name, description, created_at } = req.body;
        
        if (!id || !name) {
            return res.status(400).json({ error: 'id and name are required' });
        }

        const stmt = db.prepare(
            'INSERT INTO warehouses (id, name, description, created_at) VALUES (?, ?, ?, ?)'
        );
        stmt.run([id, name, description || '', created_at || new Date().toISOString()]);
        db.save();

        res.json({ id, name, description: description || '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== MOVEMENT HISTORY =====
app.get('/api/movements', (req, res) => {
    try {
        const { warehouseId, categoryId, startDate, endDate } = req.query;
        
        let query = `
            SELECT 
                m.id,
                m.type,
                m.quantity,
                m.date,
                m.notes,
                p.name as product_name,
                c.name as category_name,
                w.name as warehouse_name
            FROM movements m
            JOIN products p ON m.product_id = p.id
            JOIN categories c ON p.category_id = c.id
            JOIN warehouses w ON c.warehouse_id = w.id
            WHERE 1=1
        `;
        const params = [];
        
        if (warehouseId) {
            query += ' AND w.id = ?';
            params.push(warehouseId);
        }
        
        if (categoryId) {
            query += ' AND c.id = ?';
            params.push(categoryId);
        }
        
        if (startDate) {
            query += ' AND m.date >= ?';
            params.push(startDate);
        }
        
        if (endDate) {
            query += ' AND m.date <= ?';
            params.push(endDate);
        }
        
        query += ' ORDER BY m.date DESC, m.id DESC';
        
        const movements = db.exec(query, params);
        res.json(movements.length > 0 ? movements[0].values : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CSV IMPORT =====
app.post('/api/warehouses/:warehouseId/import-csv', (req, res) => {
    try {
        const { warehouseId } = req.params;
        const { csvData } = req.body;

        if (!csvData) {
            return res.status(400).json({ error: 'csvData is required' });
        }

        const lines = csvData.trim().split('\n');
        if (lines.length < 2) {
            return res.status(400).json({ error: 'CSV must have at least a header and one data row' });
        }

        const header = lines[0].toLowerCase().split(',').map(h => h.trim());

        // Validate CSV format
        const requiredColumns = ['category', 'product'];
        const missingColumns = requiredColumns.filter(col => !header.includes(col));

        if (missingColumns.length > 0) {
            return res.status(400).json({
                error: `Missing required columns: ${missingColumns.join(', ')}`,
                expectedFormat: 'category,product'
            });
        }

        const categoryIdx = header.indexOf('category');
        const productIdx = header.indexOf('product');

        const insertCategory = db.prepare(
            'INSERT OR IGNORE INTO categories (name, warehouse_id) VALUES (?, ?)'
        );
        const getCategory = db.prepare(
            'SELECT id FROM categories WHERE name = ? AND warehouse_id = ?'
        );
        const insertProduct = db.prepare(
            'INSERT INTO products (name, description, category_id, quantity) VALUES (?, "", ?, 0)'
        );

        let imported = { categories: 0, products: 0 };

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());

            const categoryName = values[categoryIdx];
            const productName = values[productIdx];

            if (!categoryName || !productName) continue;

            // Create category if not exists
            insertCategory.run([categoryName, warehouseId]);

            // Get category ID
            const categoryResult = getCategory.run([categoryName, warehouseId]);
            const categoryId = categoryResult.values[0][0];

            // Create product
            insertProduct.run([productName, categoryId]);
            imported.products++;
        }

        // Count categories
        const categoryCount = db.exec(
            'SELECT COUNT(*) FROM categories WHERE warehouse_id = ?',
            [warehouseId]
        );
        imported.categories = categoryCount[0].values[0][0];

        db.save();
        res.json({
            message: 'CSV imported successfully',
            imported
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== SERVE FRONTEND =====
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
    app.listen(PORT, () => {
        console.log(`\n🏭 Warehouse Management System running at:`);
        console.log(`   http://localhost:${PORT}`);
        console.log(`\n📊 Press Ctrl+C to stop the server\n`);
    });
}

start();
