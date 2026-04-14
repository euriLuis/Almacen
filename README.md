# Sistema de Gestión de Almacenes

Sistema local para la gestión de inventarios en almacenes múltiples.

## Características

- **Gestión de Almacenes**: Crear, ver y eliminar almacenes
- **Categorías y Productos**: Organización jerárquica dentro de cada almacén
- **Entradas y Salidas**: Registro de movimientos de inventario
- **Resumen Diario**: Visualización de movimientos del día
- **Historial Completo**: Historial de todos los movimientos con filtros
- **Importación CSV**: Carga masiva de productos desde archivos CSV

## Instalación y Uso

### 1. Instalar dependencias
```bash
npm install
```

### 2. Iniciar el servidor
```bash
# Modo desarrollo (con auto-reload)
npm run dev

# Modo producción
npm start
```

### 3. Acceder a la aplicación
Abre tu navegador en: **http://localhost:3000**

## Formato de Importación CSV

El sistema acepta archivos CSV para importar productos masivamente.

### Estructura del CSV

```csv
category,product
```

### Columnas

| Columna | Requerida | Descripción |
|---------|-----------|-------------|
| `category` | ✅ Sí | Nombre de la categoría (se crea automáticamente si no existe) |
| `product` | ✅ Sí | Nombre del producto |

### Ejemplo de CSV

```csv
category,product
Electrónicos,Laptop Dell
Electrónicos,Mouse Logitech
Electrónicos,Teclado Mecánico
Office,Papel A4
Office,Bolígrafos
Limpieza,Desinfectante
```

### Notas importantes

- La **primera línea debe ser el encabezado** exactamente como se muestra arriba
- Las categorías se crean automáticamente si no existen
- Todos los productos se importan con **stock inicial = 0**
- No usar comas dentro de los valores

## Estructura del Proyecto

```
almacen/
├── server.js           # Servidor Express con todas las rutas API
├── database.js         # Inicialización de base de datos SQLite
├── package.json        # Configuración del proyecto
├── warehouse.db        # Base de datos SQLite (se crea automáticamente)
├── public/
│   └── index.html      # Frontend completo con todas las funcionalidades
└── README.md           # Este archivo
```

## API Endpoints

### Almacenes
- `GET /api/warehouses` - Listar almacenes
- `POST /api/warehouses` - Crear almacén
- `DELETE /api/warehouses/:id` - Eliminar almacén

### Categorías
- `GET /api/warehouses/:warehouseId/categories` - Listar categorías
- `POST /api/warehouses/:warehouseId/categories` - Crear categoría
- `DELETE /api/categories/:id` - Eliminar categoría

### Productos
- `GET /api/categories/:categoryId/products` - Listar productos
- `GET /api/warehouses/:warehouseId/products` - Listar productos por almacén
- `POST /api/categories/:categoryId/products` - Crear producto
- `DELETE /api/products/:id` - Eliminar producto

### Movimientos
- `POST /api/movements` - Registrar entradas/salidas
- `GET /api/movements` - Obtener historial con filtros

### Reportes
- `GET /api/summary/daily?date=YYYY-MM-DD` - Resumen diario

### Importación
- `POST /api/warehouses/:warehouseId/import-csv` - Importar CSV

## Tecnologías

- **Backend**: Node.js + Express
- **Base de Datos**: SQLite (sql.js - versión en memoria que persiste en archivo)
- **Frontend**: HTML5 + CSS3 + JavaScript Vanilla
