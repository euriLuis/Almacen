const express = require('express');
const cors = require('cors');
const path = require('path');
const initDb = require('./database');
const log = require('./logger');

const app = express();
const PORT = 3000;

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware with timing
app.use((req, res, next) => {
    const start = Date.now();
    log.request(req.method, req.url, req.body);
    res.on('finish', () => {
        const duration = Date.now() - start;
        log.response(req.method, req.url, res.statusCode, duration);
    });
    next();
});

// Global error handling middleware
app.use((err, req, res, next) => {
    log.error('EXPRESS_MIDDLEWARE', `Unhandled error in ${req.method} ${req.url}`, err);
    const errorResponse = buildErrorResponse(err);
    res.status(errorResponse.status).json(errorResponse.body);
});

// ==================== HELPER ====================

function buildErrorResponse(err) {
    if (err && typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
        return {
            status: 409,
            body: {
                error: 'The record already exists and cannot be duplicated',
                code: 'DUPLICATE_RECORD'
            }
        };
    }

    return {
        status: 500,
        body: {
            error: 'An unexpected error occurred',
            code: 'INTERNAL_SERVER_ERROR',
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Wraps a route handler with consistent error handling.
 * If the handler throws synchronously, it's caught and logged.
 */
function handleRoute(handler) {
    return (req, res) => {
        try {
            handler(req, res);
        } catch (err) {
            log.error('ROUTE_HANDLER', `Error in ${req.method} ${req.url}`, err);
            const errorResponse = buildErrorResponse(err);
            res.status(errorResponse.status).json(errorResponse.body);
        }
    };
}

// ==================== API ROUTES ====================

async function start() {
    let db;
    try {
        db = await initDb();
        log.action('DATABASE', 'Database initialized successfully');
    } catch (err) {
        log.error('DATABASE_INIT', 'Failed to initialize database', err);
        process.exit(1);
    }

    // ===== WAREHOUSES =====

    app.get('/api/warehouses', handleRoute((req, res) => {
        const result = db.exec('SELECT id, name, description FROM warehouses ORDER BY name');
        log.db('READ', 'Fetching all warehouses');
        res.json(result.length > 0 ? result[0].values : []);
    }));

    app.post('/api/warehouses', handleRoute((req, res) => {
        const { name, description } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Warehouse name is required and must be a non-empty string',
                code: 'VALIDATION_ERROR',
                field: 'name'
            });
        }

        const sanitizedName = name.trim();
        const sanitizedDesc = (description && typeof description === 'string') ? description.trim() : '';

        const stmt = db.prepare('INSERT INTO warehouses (name, description) VALUES (?, ?)');
        stmt.run([sanitizedName, sanitizedDesc]);
        db.save();

        const result = db.exec('SELECT last_insert_rowid()');
        const newId = result[0].values[0][0];

        log.action('WAREHOUSE_CREATE', `Created warehouse "${sanitizedName}"`, { id: newId });

        res.status(201).json({ id: newId, name: sanitizedName, description: sanitizedDesc });
    }));

    app.delete('/api/warehouses/:id', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        // Check if warehouse exists before deleting
        const exists = db.exec('SELECT id, name FROM warehouses WHERE id = ?', [id]);
        if (exists.length === 0 || exists[0].values.length === 0) {
            return res.status(404).json({
                error: `Warehouse with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const warehouseName = exists[0].values[0][1];
        db.run('DELETE FROM warehouses WHERE id = ?', [id]);
        db.save();

        log.action('WAREHOUSE_DELETE', `Deleted warehouse "${warehouseName}" (ID: ${id})`);

        res.json({ message: 'Warehouse deleted successfully' });
    }));

    // ===== CATEGORIES =====

    app.get('/api/warehouses/:warehouseId/categories', handleRoute((req, res) => {
        const warehouseId = parseInt(req.params.warehouseId);
        if (isNaN(warehouseId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        // Verify warehouse exists
        const whExists = db.exec('SELECT id, name FROM warehouses WHERE id = ?', [warehouseId]);
        if (whExists.length === 0 || whExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Warehouse with ID ${warehouseId} not found`,
                code: 'NOT_FOUND'
            });
        }

        log.db('READ', `Fetching categories for warehouse ID ${warehouseId}`);

        const result = db.exec(
            'SELECT id, name, warehouse_id FROM categories WHERE warehouse_id = ? ORDER BY name',
            [warehouseId]
        );
        res.json(result.length > 0 ? result[0].values : []);
    }));

    app.post('/api/warehouses/:warehouseId/categories', handleRoute((req, res) => {
        const warehouseId = parseInt(req.params.warehouseId);
        if (isNaN(warehouseId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Category name is required and must be a non-empty string',
                code: 'VALIDATION_ERROR',
                field: 'name'
            });
        }

        // Verify warehouse exists
        const whExists = db.exec('SELECT id, name FROM warehouses WHERE id = ?', [warehouseId]);
        if (whExists.length === 0 || whExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Warehouse with ID ${warehouseId} not found`,
                code: 'NOT_FOUND'
            });
        }

        const sanitizedName = name.trim();
        const stmt = db.prepare('INSERT INTO categories (name, warehouse_id) VALUES (?, ?)');
        stmt.run([sanitizedName, warehouseId]);
        db.save();

        const result = db.exec('SELECT last_insert_rowid()');
        const newId = result[0].values[0][0];

        log.action('CATEGORY_CREATE', `Created category "${sanitizedName}" in warehouse ID ${warehouseId}`, {
            id: newId,
            warehouseId
        });

        res.status(201).json({ id: newId, name: sanitizedName, warehouse_id: warehouseId });
    }));

    app.delete('/api/categories/:id', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid category ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        // Get category info before deleting
        const catExists = db.exec('SELECT id, name, warehouse_id FROM categories WHERE id = ?', [id]);
        if (catExists.length === 0 || catExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Category with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const catName = catExists[0].values[0][1];
        db.run('DELETE FROM categories WHERE id = ?', [id]);
        db.save();

        log.action('CATEGORY_DELETE', `Deleted category "${catName}" (ID: ${id})`);

        res.json({ message: 'Category deleted successfully' });
    }));

    // ===== PRODUCTS =====

    app.post('/api/categories/:categoryId/products', handleRoute((req, res) => {
        const categoryId = parseInt(req.params.categoryId);
        if (isNaN(categoryId)) {
            return res.status(400).json({
                error: 'Invalid category ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'categoryId'
            });
        }

        const { name, description } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Product name is required and must be a non-empty string',
                code: 'VALIDATION_ERROR',
                field: 'name'
            });
        }

        // Verify category exists
        const catResult = db.exec('SELECT id, name, warehouse_id FROM categories WHERE id = ?', [categoryId]);
        if (catResult.length === 0 || catResult[0].values.length === 0) {
            return res.status(404).json({
                error: `Category with ID ${categoryId} not found`,
                code: 'NOT_FOUND'
            });
        }

        const categoryName = catResult[0].values[0][1];
        const sanitizedName = name.trim();
        const sanitizedDesc = (description && typeof description === 'string') ? description.trim() : '';

        const stmt = db.prepare(
            'INSERT INTO products (name, description, category_id, quantity) VALUES (?, ?, ?, 0)'
        );
        stmt.run([sanitizedName, sanitizedDesc, categoryId]);
        db.save();

        const result = db.exec('SELECT last_insert_rowid()');
        const newId = result[0].values[0][0];

        log.action('PRODUCT_CREATE', `Created product "${sanitizedName}" in category "${categoryName}"`, {
            id: newId,
            categoryId
        });

        res.status(201).json({
            id: newId,
            name: sanitizedName,
            description: sanitizedDesc,
            category_id: categoryId,
            quantity: 0
        });
    }));

    app.put('/api/products/:id', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid product ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        const { name, quantity } = req.body;

        // Validate that at least one field is being updated
        if ((name === undefined || name === null) && (quantity === undefined || quantity === null)) {
            return res.status(400).json({
                error: 'At least one field (name or quantity) must be provided for update',
                code: 'VALIDATION_ERROR',
                field: 'body'
            });
        }

        // Get product info before updating
        const prodExists = db.exec(
            'SELECT id, name, category_id, quantity FROM products WHERE id = ?',
            [id]
        );
        if (prodExists.length === 0 || prodExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Product with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const oldProduct = prodExists[0].values[0];
        const oldName = oldProduct[1];
        const oldQuantity = oldProduct[3];
        const categoryId = oldProduct[2];

        // Validate and prepare updates
        const updates = {};
        const params = [];

        if (name !== undefined && name !== null) {
            const sanitizedName = typeof name === 'string' ? name.trim() : name;
            if (!sanitizedName || typeof sanitizedName !== 'string' || sanitizedName.length === 0) {
                return res.status(400).json({
                    error: 'Product name must be a non-empty string',
                    code: 'VALIDATION_ERROR',
                    field: 'name'
                });
            }

            // Check if another product with same name exists in same category
            const duplicateCheck = db.exec(
                'SELECT id FROM products WHERE name = ? AND category_id = ? AND id != ?',
                [sanitizedName, categoryId, id]
            );
            if (duplicateCheck.length > 0 && duplicateCheck[0].values.length > 0) {
                return res.status(409).json({
                    error: `A product with name "${sanitizedName}" already exists in this category`,
                    code: 'DUPLICATE_NAME',
                    field: 'name'
                });
            }

            updates.name = sanitizedName;
            params.push(sanitizedName);
        }

        if (quantity !== undefined && quantity !== null) {
            const qty = parseInt(quantity);
            if (isNaN(qty) || qty < 0) {
                return res.status(400).json({
                    error: 'Product quantity must be a non-negative integer',
                    code: 'VALIDATION_ERROR',
                    field: 'quantity'
                });
            }
            updates.quantity = qty;
            params.push(qty);
        }

        // Build and execute update query
        const updateFields = Object.keys(updates)
            .map(field => `${field} = ?`)
            .join(', ');
        params.push(id);

        db.run(`UPDATE products SET ${updateFields} WHERE id = ?`, params);
        db.save();

        // Log the update
        const changes = [];
        if (updates.name) changes.push(`name: "${oldName}" → "${updates.name}"`);
        if (updates.quantity !== undefined) changes.push(`quantity: ${oldQuantity} → ${updates.quantity}`);

        log.action('PRODUCT_UPDATE', `Updated product ID ${id}: ${changes.join(', ')}`);

        res.json({
            message: 'Product updated successfully',
            id,
            changes: {
                ...(updates.name && { name: { old: oldName, new: updates.name } }),
                ...(updates.quantity !== undefined && { quantity: { old: oldQuantity, new: updates.quantity } })
            }
        });
    }));

    // ===== QUICK STOCK UPDATE =====
    // PATCH endpoint for quick quantity updates from inventory view
    app.patch('/api/products/:id/quantity', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid product ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        const { quantity } = req.body;

        if (quantity === undefined || quantity === null) {
            return res.status(400).json({
                error: 'Quantity is required',
                code: 'VALIDATION_ERROR',
                field: 'quantity'
            });
        }

        const qty = parseInt(quantity);
        if (isNaN(qty) || qty < 0) {
            return res.status(400).json({
                error: 'Quantity must be a non-negative integer',
                code: 'VALIDATION_ERROR',
                field: 'quantity'
            });
        }

        const productInfo = db.exec(`
            SELECT p.id, p.name, p.quantity, c.warehouse_id
            FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?
        `, [id]);

        if (productInfo.length === 0 || productInfo[0].values.length === 0) {
            return res.status(404).json({
                error: `Product with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const [, productName, oldQuantity, warehouseId] = productInfo[0].values[0];
        const diff = qty - oldQuantity;

        if (diff !== 0) {
            const movementType = diff > 0 ? 'entry' : 'exit';
            const movementQty = Math.abs(diff);
            const today = getLocalDateString();
            
            db.run(
                'INSERT INTO movements (product_id, warehouse_id, type, quantity, date, notes) VALUES (?, ?, ?, ?, ?, ?)',
                [id, warehouseId, movementType, movementQty, today, 'Ajuste manual de inventario']
            );
        }

        // Update quantity
        db.run('UPDATE products SET quantity = ? WHERE id = ?', [qty, id]);
        db.save();

        log.action('STOCK_UPDATE', `Updated stock for "${productName}" (ID: ${id}): ${oldQuantity} → ${qty} unidades (Recorded as movement: ${diff})`);

        res.json({
            message: 'Stock updated successfully',
            id,
            product: productName,
            quantity: {
                old: oldQuantity,
                new: qty
            }
        });
    }));

    app.delete('/api/products/:id', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid product ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        // Get product info before deleting
        const prodExists = db.exec('SELECT id, name, category_id FROM products WHERE id = ?', [id]);
        if (prodExists.length === 0 || prodExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Product with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const prodName = prodExists[0].values[0][1];
        db.run('DELETE FROM products WHERE id = ?', [id]);
        db.save();

        log.action('PRODUCT_DELETE', `Deleted product "${prodName}" (ID: ${id})`);

        res.json({ message: 'Product deleted successfully' });
    }));

    // ===== INVENTORY (all products for a warehouse with filters) =====

    app.get('/api/inventory', handleRoute((req, res) => {
        const { warehouseId, categoryId, search } = req.query;

        if (!warehouseId) {
            log.db('READ', 'Inventory fetch skipped: no warehouseId provided');
            return res.json([]);
        }

        const whId = parseInt(warehouseId);
        if (isNaN(whId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

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
            WHERE c.warehouse_id = ?
        `;
        const params = [whId];

        if (categoryId) {
            const catId = parseInt(categoryId);
            if (isNaN(catId)) {
                return res.status(400).json({
                    error: 'Invalid category ID: must be a number',
                    code: 'VALIDATION_ERROR',
                    field: 'categoryId'
                });
            }
            query += ' AND c.id = ?';
            params.push(catId);
        }

        if (search && typeof search === 'string') {
            query += ' AND p.name LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY c.name, p.name';

        log.db('READ', `Fetching inventory for warehouse ${whId}${search ? `, search: "${search}"` : ''}`);

        const result = db.exec(query, params);
        res.json(result.length > 0 ? result[0].values : []);
    }));

    // ===== MOVEMENTS =====

    app.post('/api/movements', handleRoute((req, res) => {
        const { products, type, quantity, notes } = req.body;

        // Support both single-product and multi-product formats
        let items = [];
        if (products && Array.isArray(products)) {
            // Multi-product format: [{ productId, quantity }]
            if (products.length === 0) {
                return res.status(400).json({
                    error: 'Products array must contain at least one product',
                    code: 'VALIDATION_ERROR',
                    field: 'products'
                });
            }
            items = products;
        } else {
            // Single-product format (backward compatible)
            const productId = req.body.productId;
            if (!productId) {
                return res.status(400).json({
                    error: 'Product ID is required. Provide either "productId" (single) or "products" array (multiple)',
                    code: 'VALIDATION_ERROR',
                    field: 'productId'
                });
            }
            if (!type) {
                return res.status(400).json({
                    error: 'Movement type is required (must be "entry" or "exit")',
                    code: 'VALIDATION_ERROR',
                    field: 'type'
                });
            }
            if (quantity === undefined || quantity === null) {
                return res.status(400).json({
                    error: 'Quantity is required and must be a positive number',
                    code: 'VALIDATION_ERROR',
                    field: 'quantity'
                });
            }
            items = [{ productId, quantity }];
        }

        if (type !== 'entry' && type !== 'exit') {
            return res.status(400).json({
                error: `Invalid movement type "${type}". Must be "entry" or "exit"`,
                code: 'VALIDATION_ERROR',
                field: 'type'
            });
        }

        const today = getLocalDateString();
        const results = [];

        const insertMovement = db.prepare(
            'INSERT INTO movements (product_id, warehouse_id, type, quantity, date, notes) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const updateStock = db.prepare(
            'UPDATE products SET quantity = quantity + ? WHERE id = ?'
        );

        // Process each product
        for (const item of items) {
            const { productId, quantity: qty } = item;

            if (!productId) {
                return res.status(400).json({
                    error: `Each product must have a valid productId`,
                    code: 'VALIDATION_ERROR',
                    field: 'products'
                });
            }

            const parsedId = parseInt(productId);
            if (isNaN(parsedId)) {
                return res.status(400).json({
                    error: `Invalid product ID: ${productId}. Must be a number`,
                    code: 'VALIDATION_ERROR',
                    field: 'productId'
                });
            }

            const parsedQty = parseInt(qty);
            if (isNaN(parsedQty) || parsedQty <= 0) {
                return res.status(400).json({
                    error: `Invalid quantity for product ID ${parsedId}: must be a positive integer (got: ${qty})`,
                    code: 'VALIDATION_ERROR',
                    field: 'quantity'
                });
            }

            // Get product info including warehouse
            const productResult = db.exec(`
                SELECT p.id, p.name, p.quantity, c.warehouse_id
                FROM products p
                JOIN categories c ON p.category_id = c.id
                WHERE p.id = ?
            `, [parsedId]);

            if (productResult.length === 0 || productResult[0].values.length === 0) {
                return res.status(404).json({
                    error: `Product not found (ID: ${parsedId})`,
                    code: 'NOT_FOUND'
                });
            }

            const product = productResult[0].values[0];
            const currentStock = product[2];
            const warehouseId = product[3];
            const productName = product[1];

            // Validate stock for exits
            if (type === 'exit' && parsedQty > currentStock) {
                return res.status(400).json({
                    error: `Insufficient stock for "${productName}". Requested: ${parsedQty}, Available: ${currentStock}`,
                    code: 'INSUFFICIENT_STOCK',
                    productId: parsedId,
                    productName,
                    currentStock,
                    requested: parsedQty
                });
            }

            const stockChange = type === 'entry' ? parsedQty : -parsedQty;

            insertMovement.run([parsedId, warehouseId, type, parsedQty, today, notes || '']);
            updateStock.run([stockChange, parsedId]);

            const newStock = currentStock + stockChange;
            results.push({ productId: parsedId, productName, quantity: parsedQty, newStock });
        }

        db.save();

        const typeLabel = type === 'entry' ? 'Entry' : 'Exit';
        log.action('MOVEMENT_CREATE', `${typeLabel} movement: ${results.map(r => `${r.productName} (${r.quantity})`).join(', ')}`, {
            type,
            notes: notes || null,
            results
        });

        res.json({
            message: `Movement recorded successfully`,
            results,
            type,
            totalProducts: results.length
        });
    }));

    app.get('/api/movements', handleRoute((req, res) => {
        const { warehouseId, limit, date } = req.query;

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
        `;
        const params = [];
        const conditions = [];

        if (warehouseId) {
            const whId = parseInt(warehouseId);
            if (isNaN(whId)) {
                return res.status(400).json({
                    error: 'Invalid warehouse ID: must be a number',
                    code: 'VALIDATION_ERROR',
                    field: 'warehouseId'
                });
            }
            conditions.push('w.id = ?');
            params.push(whId);
        }

        if (date) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({
                    error: 'Invalid date format: must be YYYY-MM-DD',
                    code: 'VALIDATION_ERROR',
                    field: 'date'
                });
            }
            conditions.push('DATE(m.date) = ?');
            params.push(date);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY m.date DESC, m.id DESC';

        if (limit) {
            const parsedLimit = parseInt(limit);
            if (isNaN(parsedLimit) || parsedLimit < 1) {
                return res.status(400).json({
                    error: 'Invalid limit: must be a positive number',
                    code: 'VALIDATION_ERROR',
                    field: 'limit'
                });
            }
            query += ' LIMIT ?';
            params.push(parsedLimit);
        }

        log.db('READ', `Fetching movements${warehouseId ? ` for warehouse ${warehouseId}` : ''}`);

        const result = db.exec(query, params);
        res.json(result.length > 0 ? result[0].values : []);
    }));

    // ===== SUMMARY =====
    app.get('/api/summary', handleRoute((req, res) => {
        const { warehouseId } = req.query;

        if (!warehouseId) {
            return res.status(400).json({
                error: 'Warehouse ID is required',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        const whId = parseInt(warehouseId);
        if (isNaN(whId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        const query = `
            SELECT
                p.id,
                p.name as product_name,
                c.name as category_name,
                COALESCE(SUM(CASE WHEN m.type = 'entry' THEN m.quantity ELSE 0 END), 0) as total_entries,
                COALESCE(SUM(CASE WHEN m.type = 'exit' THEN m.quantity ELSE 0 END), 0) as total_exits,
                p.quantity as current_stock
            FROM products p
            JOIN categories c ON p.category_id = c.id
            LEFT JOIN movements m ON p.id = m.product_id
            WHERE c.warehouse_id = ?
            GROUP BY p.id, p.name, c.name, p.quantity
            ORDER BY p.name ASC
        `;

        log.db('READ', `Fetching summary for warehouse ${whId}`);
        
        const result = db.exec(query, [whId]);
        res.json(result.length > 0 ? result[0].values : []);
    }));

    // ===== SUMMARY BY DATE =====
    app.get('/api/summary-by-date', handleRoute((req, res) => {
        const { warehouseId, date } = req.query;

        if (!warehouseId) {
            return res.status(400).json({
                error: 'Warehouse ID is required',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        const whId = parseInt(warehouseId);
        if (isNaN(whId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        // Date format: YYYY-MM-DD, default to today
        const selectedDate = date || getLocalDateString();

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
            return res.status(400).json({
                error: 'Invalid date format: must be YYYY-MM-DD',
                code: 'VALIDATION_ERROR',
                field: 'date'
            });
        }

        const query = `
            SELECT
                p.id,
                p.name as product_name,
                c.name as category_name,
                -- Entradas del día seleccionado
                COALESCE(SUM(CASE WHEN m.type = 'entry' AND DATE(m.date) = ? THEN m.quantity ELSE 0 END), 0) as day_entries,
                -- Salidas del día seleccionado
                COALESCE(SUM(CASE WHEN m.type = 'exit' AND DATE(m.date) = ? THEN m.quantity ELSE 0 END), 0) as day_exits,
                -- Entradas posteriores (desde el día siguiente en adelante)
                COALESCE(SUM(CASE WHEN m.type = 'entry' AND DATE(m.date) > ? THEN m.quantity ELSE 0 END), 0) as future_entries,
                -- Salidas posteriores (desde el día siguiente en adelante)
                COALESCE(SUM(CASE WHEN m.type = 'exit' AND DATE(m.date) > ? THEN m.quantity ELSE 0 END), 0) as future_exits,
                -- Stock actual
                p.quantity as current_stock
            FROM products p
            JOIN categories c ON p.category_id = c.id
            LEFT JOIN movements m ON p.id = m.product_id AND c.warehouse_id = m.warehouse_id
            WHERE c.warehouse_id = ?
            GROUP BY p.id, p.name, c.name, p.quantity
            ORDER BY p.name ASC
        `;

        log.db('READ', `Fetching summary for warehouse ${whId} on date ${selectedDate}`);
        
        const result = db.exec(query, [selectedDate, selectedDate, selectedDate, selectedDate, whId]);
        const rows = result.length > 0 ? result[0].values : [];

        // Transform the data to include calculated initial stock correctly
        const transformedRows = rows.map(row => {
            const [id, productName, categoryName, dayEntries, dayExits, futureEntries, futureExits, currentStock] = row;
            
            // finalStock at the end of the selected date:
            const stockEnd = currentStock - futureEntries + futureExits;
            // initialStock at the beginning of the selected date:
            const stockStart = stockEnd - dayEntries + dayExits;
            
            return [
                id,
                productName,
                categoryName,
                stockStart,             // Stock inicial del día
                dayEntries,              // Entradas del día
                dayExits,                // Salidas del día
                stockEnd                 // Stock final del día
            ];
        });

        res.json(transformedRows);
    }));

    app.post('/api/warehouses/:warehouseId/set-start-of-day', handleRoute((req, res) => {
        const warehouseId = parseInt(req.params.warehouseId);
        if (isNaN(warehouseId)) {
            return res.status(400).json({ error: 'Invalid warehouse ID' });
        }

        const today = getLocalDateString();
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = getLocalDateString(yesterdayDate);

        // Move all current day's manual adjustments to yesterday
        // allowing the adjusted stock to be the "mathematical start" of today
        db.run(`
            UPDATE movements 
            SET date = ? 
            WHERE warehouse_id = ? 
            AND date = ? 
            AND notes = 'Ajuste manual de inventario'
        `, [yesterday, warehouseId, today]);
        
        db.save();

        log.action('SET_START_DAY', `Set manual adjustments to yesterday for warehouse ${warehouseId}`);
        res.json({ success: true, message: 'Stock starting point has been defined' });
    }));

    app.delete('/api/movements/:id', handleRoute((req, res) => {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Invalid movement ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'id'
            });
        }

        // 1. Get movement data
        const movementResult = db.exec(
            'SELECT id, product_id, type, quantity, notes FROM movements WHERE id = ?',
            [id]
        );

        if (movementResult.length === 0 || movementResult[0].values.length === 0) {
            return res.status(404).json({
                error: `Movement with ID ${id} not found`,
                code: 'NOT_FOUND'
            });
        }

        const movement = movementResult[0].values[0];
        const productId = movement[1];
        const type = movement[2];
        const quantity = movement[3];

        // 2. Get current product stock
        const productResult = db.exec('SELECT id, name, quantity FROM products WHERE id = ?', [productId]);
        if (productResult.length === 0 || productResult[0].values.length === 0) {
            return res.status(404).json({
                error: `Associated product (ID: ${productId}) not found. Data may be inconsistent`,
                code: 'DATA_INCONSISTENCY'
            });
        }

        const productName = productResult[0].values[0][1];
        const currentStock = productResult[0].values[0][2];

        // 3. Revert stock
        let newStock;
        if (type === 'entry') {
            newStock = currentStock - quantity;
        } else {
            newStock = currentStock + quantity;
        }

        // 4. Validate no negative stock
        if (newStock < 0) {
            log.warn('MOVEMENT_DELETE_REVERT', `Reverting movement would cause negative stock`, {
                movementId: id,
                product: productName,
                currentStock,
                quantity,
                type,
                wouldBeStock: newStock
            });
            return res.status(400).json({
                error: `Cannot reverse this movement: would result in negative stock for "${productName}" (current: ${currentStock}, after revert: ${newStock})`,
                code: 'WOULD_CAUSE_NEGATIVE_STOCK',
                currentStock,
                wouldBeStock: newStock
            });
        }

        // 5. Update product stock
        db.run('UPDATE products SET quantity = ? WHERE id = ?', [newStock, productId]);

        // 6. Delete movement
        db.run('DELETE FROM movements WHERE id = ?', [id]);

        // 7. Save to disk
        db.save();

        log.action('MOVEMENT_DELETE', `Reverted movement #${id}: ${type} ${quantity} of "${productName}"`, {
            movementId: id,
            product: productName,
            type,
            quantity,
            previousStock: currentStock,
            newStock
        });

        res.json({
            success: true,
            message: `Movement reverted. Stock for "${productName}" updated from ${currentStock} to ${newStock}`,
            newStock
        });
    }));

    // ===== CSV IMPORT =====

    app.post('/api/warehouses/:warehouseId/import-csv', handleRoute((req, res) => {
        const { csvData } = req.body;

        if (!csvData || typeof csvData !== 'string' || csvData.trim().length === 0) {
            return res.status(400).json({
                error: 'CSV data is required and must be a non-empty string',
                code: 'VALIDATION_ERROR',
                field: 'csvData'
            });
        }

        const warehouseId = parseInt(req.params.warehouseId);
        if (isNaN(warehouseId)) {
            return res.status(400).json({
                error: 'Invalid warehouse ID: must be a number',
                code: 'VALIDATION_ERROR',
                field: 'warehouseId'
            });
        }

        // Verify warehouse exists
        const whExists = db.exec('SELECT id, name FROM warehouses WHERE id = ?', [warehouseId]);
        if (whExists.length === 0 || whExists[0].values.length === 0) {
            return res.status(404).json({
                error: `Warehouse with ID ${warehouseId} not found`,
                code: 'NOT_FOUND'
            });
        }

        const warehouseName = whExists[0].values[0][1];
        const lines = csvData.replace(/\r/g, '').trim().split('\n');

        if (lines.length < 2) {
            return res.status(400).json({
                error: `CSV must have at least a header row and one data row (found ${lines.length} row(s))`,
                code: 'VALIDATION_ERROR',
                field: 'csvData'
            });
        }

        const header = lines[0].toLowerCase().split(',').map(h => h.trim());
        const requiredColumns = ['category', 'product'];
        const missingColumns = requiredColumns.filter(col => !header.includes(col));

        if (missingColumns.length > 0) {
            return res.status(400).json({
                error: `CSV is missing required column(s): ${missingColumns.join(', ')}`,
                code: 'CSV_FORMAT_ERROR',
                expectedFormat: 'category,product[,stock]',
                missingColumns
            });
        }

        const categoryIdx = header.indexOf('category');
        const productIdx = header.indexOf('product');
        const stockIdx = header.includes('stock') ? header.indexOf('stock') : -1;

        let imported = { categories: 0, products: 0 };
        let updatedProducts = 0;
        let skippedRows = 0;
        let errors = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const requiredColumns = stockIdx >= 0 ? 3 : 2;
            if (values.length < requiredColumns) {
                skippedRows++;
                errors.push(`Row ${i + 1}: Insufficient columns, expected at least ${requiredColumns}, got ${values.length}, skipped`);
                continue;
            }
            const categoryName = values[categoryIdx] || '';
            const productName = values[productIdx] || '';
            const stockValue = stockIdx >= 0 ? parseInt(values[stockIdx]) || 0 : 0;

            if (!categoryName || !productName) {
                skippedRows++;
                errors.push(`Row ${i + 1}: Missing category or product name, skipped`);
                continue;
            }

            try {
                let catResult = db.exec(
                    'SELECT id FROM categories WHERE name = ? AND warehouse_id = ?',
                    [categoryName, warehouseId]
                );

                if (!catResult.length || !catResult[0].values.length) {
                    db.run(
                        'INSERT INTO categories (name, warehouse_id) VALUES (?, ?)',
                        [categoryName, warehouseId]
                    );
                    imported.categories++;
                    catResult = db.exec(
                        'SELECT id FROM categories WHERE name = ? AND warehouse_id = ?',
                        [categoryName, warehouseId]
                    );
                }
                
                if (catResult && catResult.length > 0 && catResult[0].values.length > 0) {
                    const categoryId = catResult[0].values[0][0];
                    
                    // Check if product already exists
                    const existingProduct = db.exec(
                        'SELECT id, quantity FROM products WHERE name = ? AND category_id = ?',
                        [productName, categoryId]
                    );
                    
                    if (existingProduct && existingProduct.length > 0 && existingProduct[0].values.length > 0) {
                        // Product exists: update stock (add to existing)
                        if (stockValue > 0) {
                            db.run(
                                'UPDATE products SET quantity = quantity + ? WHERE name = ? AND category_id = ?',
                                [stockValue, productName, categoryId]
                            );
                            updatedProducts++;
                        }
                    } else {
                        // New product: insert with stock value (set initial quantity)
                        db.run(
                            'INSERT INTO products (name, description, category_id, quantity) VALUES (?, "", ?, ?)',
                            [productName, categoryId, stockValue]
                        );
                        imported.products++;
                    }
                } else {
                    errors.push(`Row ${i + 1}: Category "${categoryName}" could not be found or created`);
                }
            } catch (rowErr) {
                errors.push(`Row ${i + 1} (${categoryName} > ${productName}): ${rowErr.message}`);
                log.warn('CSV_IMPORT_ROW_ERROR', `Error processing row ${i + 1}`, rowErr);
            }
        }

        db.save();

        log.action('CSV_IMPORT', `Imported CSV to warehouse "${warehouseName}"`, {
            warehouseId,
            imported,
            updatedProducts,
            skippedRows,
            errors: errors.length > 0 ? errors : null
        });

        res.json({
            message: 'CSV imported successfully',
            imported,
            updatedProducts,
            skippedRows,
            warnings: errors.length > 0 ? errors : undefined
        });
    }));

    // ===== SERVE FRONTEND =====
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Start server
    app.listen(PORT, () => {
        log.action('SERVER', `Warehouse Management System started on http://localhost:${PORT}`);
        console.log(`\n🏭 Warehouse Management System running at:`);
        console.log(`   http://localhost:${PORT}`);
        console.log(`\n📝 Logs are being written to: logs/app.log`);
        console.log(`\n📊 Press Ctrl+C to stop the server\n`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        log.action('SERVER', 'Server shutting down (SIGINT)');
        console.log('\n\n👋 Shutting down gracefully...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        log.action('SERVER', 'Server shutting down (SIGTERM)');
        process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        log.error('UNCAUGHT_EXCEPTION', 'Uncaught exception detected', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        log.error('UNHANDLED_REJECTION', 'Unhandled promise rejection detected', reason);
        process.exit(1);
    });
}

start();
