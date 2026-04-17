const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'warehouse.db');

module.exports = async function initDb() {
    const SQL = await initSqlJs();

    let db;

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
        try {
            const stats = fs.statSync(DB_PATH);
            if (stats.size > 0) {
                const buffer = fs.readFileSync(DB_PATH);
                db = new SQL.Database(buffer);
                console.log('📂 Database loaded from file');
            } else {
                console.log('⚠️  Database file is empty, creating new one');
                db = new SQL.Database();
            }
        } catch (err) {
            console.log('⚠️  Error loading database, creating new one');
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
        console.log('🆕 New database created');
    }

    // Migrate existing tables and create new ones
    // Warehouses - add UNIQUE constraint on name
    db.run(`
        CREATE TABLE IF NOT EXISTS warehouses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Categories - unique per warehouse+name
    db.run(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            warehouse_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
            UNIQUE(name, warehouse_id)
        );
    `);

    // Products - unique per category+name
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            category_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
            UNIQUE(name, category_id)
        );
    `);

    // Movements - add warehouse_id for direct filtering
    db.run(`
        CREATE TABLE IF NOT EXISTS movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            warehouse_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('entry', 'exit')),
            quantity INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
        );
    `);

    db.run('CREATE INDEX IF NOT EXISTS idx_categories_warehouse_id ON categories(warehouse_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_movements_warehouse_date ON movements(warehouse_id, date);');
    db.run('CREATE INDEX IF NOT EXISTS idx_movements_product_id ON movements(product_id);');

    // Migrate existing movements to add warehouse_id if column doesn't exist
    try {
        db.run(`ALTER TABLE movements ADD COLUMN warehouse_id INTEGER`);
        // Backfill warehouse_id from products -> categories -> warehouses
        db.run(`
            UPDATE movements
            SET warehouse_id = (
                SELECT c.warehouse_id
                FROM products p
                JOIN categories c ON p.category_id = c.id
                WHERE p.id = movements.product_id
            )
            WHERE warehouse_id IS NULL
        `);
        db.save();
        console.log('✅ Migrated movements table to include warehouse_id');
    } catch (err) {
        // Column already exists, skip
    }

    // Add save method to db object
    db.save = function() {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    };

    // Save to file after initialization
    db.save();

    console.log('✅ Database initialized with all tables');

    return db;
};
