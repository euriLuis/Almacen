const API = '/api';
let selectedWarehouseId = null;

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ===== API HELPER with logging =====
async function apiFetch(endpoint, options = {}) {
    const method = options.method || 'GET';
    const body = typeof options.body === 'string' ? options.body : null;

    console.log(`📤 [API] ${method} ${endpoint}`, body ? { body } : '');

    try {
        const start = Date.now();
        const res = await fetch(`${API}${endpoint}`, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options
        });
        const duration = Date.now() - start;
        const contentType = res.headers.get('content-type') || '';
        const rawText = await res.text();
        const data = contentType.includes('application/json')
            ? JSON.parse(rawText || '{}')
            : { error: rawText || `Unexpected ${res.status} response from server` };

        if (!res.ok) {
            console.error(`❌ [API] ${method} ${endpoint} - ${res.status} (${duration}ms)`, data);
            return { ok: false, status: res.status, data };
        }

        console.log(`✅ [API] ${method} ${endpoint} - ${res.status} (${duration}ms)`);
        return { ok: true, status: res.status, data };
    } catch (err) {
        console.error(`🚨 [API] ${method} ${endpoint} - Network Error`, err);
        return {
            ok: false,
            status: 0,
            data: {
                error: `Network error: ${err.message}. Is the server running?`,
                code: 'NETWORK_ERROR'
            }
        };
    }
}

// ===== TOAST with code display =====
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const typeClass = type === 'success' ? 'bg-emerald-500' : 'bg-rose-500';
    toast.className = `fixed bottom-6 right-6 px-6 py-3 rounded-xl text-white font-bold shadow-2xl z-50 animate-in slide-in-from-right duration-300 ${typeClass}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== SHOW API ERROR =====
function showApiError(result, context = '') {
    if (!result || result.ok) return;

    const { data, status } = result;
    const contextLabel = context ? `[${context}] ` : '';

    console.error(`❌ ${contextLabel}API Error ${status}`, {
        error: data.error,
        code: data.code,
        details: data
    });

    let message = data.error || 'Ocurrió un error inesperado';

    if (data.currentStock !== undefined && data.requested !== undefined) {
        message += `\nSolicitado: ${data.requested}, Disponible: ${data.currentStock}`;
    }

    showToast(message, 'error');
}

// ===== TAB NAVIGATION =====
document.querySelectorAll('.tab-btn-main').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn-main').forEach(t => {
            t.classList.remove('active', 'text-indigo-600', 'border-indigo-600', 'bg-indigo-50/50');
            t.classList.add('text-slate-500', 'border-transparent');
        });
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        
        tab.classList.add('active', 'text-indigo-600', 'border-indigo-600', 'bg-indigo-50/50');
        tab.classList.remove('text-slate-500', 'border-transparent');
        
        const contentId = tab.dataset.tab;
        document.getElementById(contentId).classList.remove('hidden');

        // Load tab content
        if (contentId === 'config') loadConfigTab();
        if (contentId === 'inventory') loadInventory();
        if (contentId === 'movements') loadMovementsTab();
        if (contentId === 'history') loadHistory();
        if (contentId === 'summary') loadSummary();
    });
});

// ===== SUB-TAB NAVIGATION =====
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-tab-btn');
    if (btn) {
        const parent = btn.closest('.tab-content');
        if (!parent) return;
        
        parent.querySelectorAll('.sub-tab-btn').forEach(s => {
            s.classList.remove('active', 'text-indigo-600', 'border-indigo-600');
            s.classList.add('text-slate-400', 'border-transparent');
        });
        parent.querySelectorAll('.sub-tab-content').forEach(s => s.classList.add('hidden'));
        
        btn.classList.add('active', 'text-indigo-600', 'border-indigo-600');
        btn.classList.remove('text-slate-400', 'border-transparent');
        
        const content = document.getElementById(btn.dataset.sub);
        if (content) content.classList.remove('hidden');
    }
});

// ===== GLOBAL WAREHOUSE SELECTOR =====
async function loadWarehouseDropdown() {
    const result = await apiFetch('/warehouses');
    if (!result.ok) return;

    const select = document.getElementById('globalWarehouse');
    const currentVal = select.value;

    select.innerHTML = '<option value="">Seleccionar almacén</option>' +
        result.data.map(w => `<option value="${w[0]}">${w[1]}</option>`).join('');

    if (currentVal && result.data.find(w => w[0] == currentVal)) {
        select.value = currentVal;
    } else if (result.data.length > 0 && !selectedWarehouseId) {
        select.value = result.data[0][0];
        changeWarehouse();
    }
}

let selectedSearchIdx = -1;
let filteredSearchProducts = [];
let inventoryFilterTimeout = null;

function changeWarehouse() {
    selectedWarehouseId = document.getElementById('globalWarehouse').value || null;
    const activeTab = document.querySelector('.tab-btn-main.active');
    if (activeTab) activeTab.click();
}

// ===== CONFIG TAB =====
function loadConfigTab() {
    loadWarehouseList();
    if (selectedWarehouseId) {
        loadCategoryList();
        loadProductList();
        loadProductCategoryDropdown();
    } else {
        document.getElementById('categoryList').innerHTML = noWarehouseMsg();
        document.getElementById('productList').innerHTML = noWarehouseMsg();
        document.getElementById('productCategory').innerHTML = '<option value="">Selecciona un almacén primero</option>';
    }
}

function noWarehouseMsg() {
    return `
        <div class="text-center py-12 px-6 bg-[#15151D] rounded-2xl border border-zinc-800 text-zinc-400 mt-6 shadow-sm">
            <p class="text-lg font-medium text-white mb-2"><i class="fa-solid fa-circle-exclamation text-rose-500 mr-2"></i> No hay almacén seleccionado</p>
            <p class="text-sm">Selecciona un almacén en el selector superior para gestionar contenidos.</p>
        </div>`;
}

// --- Warehouses CRUD ---
async function loadWarehouseList() {
    const result = await apiFetch('/warehouses');
    if (!result.ok) return;

    const container = document.getElementById('warehouseList');
    if (!result.data.length) {
        container.innerHTML = '<div class="text-center py-8 text-zinc-500">No hay almacenes creados.</div>';
        return;
    }

    container.innerHTML = result.data.map(w => `
        <div class="flex justify-between items-center p-4 mb-3 bg-[#1A1A24] rounded-xl border border-zinc-800/80 hover:border-indigo-500/50 transition-all shadow-sm">
            <div>
                <strong class="text-zinc-200">${w[1]}</strong>
                ${w[2] ? `<br><small class="text-zinc-500">${w[2]}</small>` : ''}
            </div>
            <button class="px-3 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 hover:border-rose-500/40 transition-colors text-sm font-semibold" onclick="deleteWarehouse(${w[0]})">Eliminar</button>
        </div>
    `).join('');
}

async function createWarehouse() {
    const name = document.getElementById('whName').value.trim();
    const description = document.getElementById('whDesc').value.trim();
    if (!name) return showToast('El nombre es obligatorio', 'error');

    const result = await apiFetch('/warehouses', {
        method: 'POST',
        body: JSON.stringify({ name, description })
    });

    if (result.ok) {
        document.getElementById('whName').value = '';
        document.getElementById('whDesc').value = '';
        showToast('Almacén creado');
        loadWarehouseDropdown();
        loadWarehouseList();
    } else {
        showApiError(result, 'CREAR ALMACÉN');
    }
}

async function deleteWarehouse(id) {
    if (!confirm('¿Eliminar este almacén y todo su contenido?')) return;
    const result = await apiFetch(`/warehouses/${id}`, { method: 'DELETE' });
    if (result.ok) {
        showToast('Almacén eliminado');
        loadWarehouseDropdown();
        loadWarehouseList();
    } else {
        showApiError(result, 'ELIMINAR ALMACÉN');
    }
}

// --- Categories CRUD ---
async function loadCategoryList() {
    if (!selectedWarehouseId) return;

    const result = await apiFetch(`/warehouses/${selectedWarehouseId}/categories`);
    if (!result.ok) return;

    const container = document.getElementById('categoryList');
    if (!result.data.length) {
        container.innerHTML = '<div class="text-center py-8 text-zinc-500">No hay categorías en este almacén.</div>';
        return;
    }

    container.innerHTML = result.data.map(c => `
        <div class="flex justify-between items-center p-4 mb-3 bg-[#1A1A24] rounded-xl border border-zinc-800/80 hover:border-indigo-500/50 transition-all shadow-sm">
            <strong class="text-zinc-200 flex items-center gap-2"><span class="text-indigo-400"><i class="fa-solid fa-folder-open"></i></span> ${c[1]}</strong>
            <button class="px-3 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 hover:border-rose-500/40 transition-colors text-sm font-semibold" onclick="deleteCategory(${c[0]})">Eliminar</button>
        </div>
    `).join('');
}

async function createCategory() {
    if (!selectedWarehouseId) return showToast('Selecciona un almacén primero', 'error');
    const name = document.getElementById('catName').value.trim();
    if (!name) return showToast('El nombre es obligatorio', 'error');

    const result = await apiFetch(`/warehouses/${selectedWarehouseId}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name })
    });

    if (result.ok) {
        document.getElementById('catName').value = '';
        showToast('Categoría creada');
        loadCategoryList();
        loadProductCategoryDropdown();
    } else {
        showApiError(result, 'CREAR CATEGORÍA');
    }
}

async function deleteCategory(id) {
    if (!confirm('¿Eliminar esta categoría y sus productos?')) return;
    const result = await apiFetch(`/categories/${id}`, { method: 'DELETE' });
    if (result.ok) {
        showToast('Categoría eliminada');
        loadCategoryList();
        loadProductCategoryDropdown();
        loadProductList();
    } else {
        showApiError(result, 'ELIMINAR CATEGORÍA');
    }
}

// --- Products CRUD ---
async function loadProductCategoryDropdown() {
    if (!selectedWarehouseId) return;

    const result = await apiFetch(`/warehouses/${selectedWarehouseId}/categories`);
    if (!result.ok) return;

    const select = document.getElementById('productCategory');
    select.innerHTML = '<option value="">Seleccionar categoría</option>' +
        result.data.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('');
}

async function loadProductList() {
    if (!selectedWarehouseId) return;

    const result = await apiFetch(`/inventory?warehouseId=${selectedWarehouseId}`);
    if (!result.ok) return;

    const container = document.getElementById('productList');
    if (!result.data.length) {
        container.innerHTML = '<div class="text-center py-8 text-zinc-500">No hay productos en este almacén.</div>';
        return;
    }

    container.innerHTML = result.data.map(p => `
        <div class="flex justify-between items-center p-4 mb-3 bg-[#1A1A24] rounded-xl border border-zinc-800/80 hover:border-indigo-500/50 transition-all shadow-sm">
            <div>
                <strong class="text-zinc-200 font-bold">${p[1]}</strong>
                ${p[2] ? `<br><small class="text-zinc-500">${p[2]}</small>` : ''}
                <br><span class="text-indigo-400 text-xs font-semibold uppercase tracking-wider"><i class="fa-solid fa-folder mr-1"></i> ${p[5]}</span>
            </div>
            <div class="flex items-center gap-4">
                <span class="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold">${p[3]} uds</span>
                <button class="w-8 h-8 flex items-center justify-center bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors" title="Editar Nombre" onclick="editProduct(${p[0]}, \`${p[1].replace(/`/g, '\\`')}\`)"><i class="fa-solid fa-pen"></i></button>
                <button class="w-8 h-8 flex items-center justify-center bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 hover:text-rose-300 transition-colors" title="Eliminar" onclick="deleteProduct(${p[0]})"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
    `).join('');
}

async function editProduct(id, currentName) {
    const rawName = window.prompt("Editar nombre del producto:", currentName);
    if (rawName === null) return; // cancelado
    const name = rawName.trim();
    if (!name) return showToast('El nombre no puede estar vacío', 'error');
    if (name === currentName) return; // sin cambios

    const result = await apiFetch(`/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name })
    });

    if (result.ok) {
        showToast('Producto actualizado');
        loadProductList();
        if (document.querySelector('.tab-btn-main.active[data-tab="inventory"]')) loadInventory();
    } else {
        showApiError(result, 'EDITAR PRODUCTO');
    }
}

async function createProduct() {
    if (!selectedWarehouseId) return showToast('Selecciona un almacén primero', 'error');
    const categoryId = document.getElementById('productCategory').value;
    const name = document.getElementById('prodName').value.trim();
    const description = document.getElementById('prodDesc').value.trim();

    if (!categoryId) return showToast('Selecciona una categoría', 'error');
    if (!name) return showToast('El nombre es obligatorio', 'error');

    const result = await apiFetch(`/categories/${categoryId}/products`, {
        method: 'POST',
        body: JSON.stringify({ name, description })
    });

    if (result.ok) {
        document.getElementById('prodName').value = '';
        document.getElementById('prodDesc').value = '';
        showToast('Producto creado');
        loadProductList();
    } else {
        showApiError(result, 'CREAR PRODUCTO');
    }
}

async function deleteProduct(id) {
    if (!confirm('¿Eliminar este producto?')) return;
    const result = await apiFetch(`/products/${id}`, { method: 'DELETE' });
    if (result.ok) {
        showToast('Producto eliminado');
        loadProductList();
    } else {
        showApiError(result, 'ELIMINAR PRODUCTO');
    }
}

// --- CSV Import ---
async function importCSV() {
    if (!selectedWarehouseId) return showToast('Selecciona un almacén primero', 'error');
    const file = document.getElementById('csvFile').files[0];
    if (!file) return showToast('Selecciona un archivo CSV', 'error');

    const reader = new FileReader();
    reader.onload = async (e) => {
        console.log('📄 [CSV IMPORT] Starting import with file content');
        const result = await apiFetch(`/warehouses/${selectedWarehouseId}/import-csv`, {
            method: 'POST',
            body: JSON.stringify({ csvData: e.target.result })
        });

        if (result.ok) {
            const updatedProducts = result.data.updatedProducts ? `, ${result.data.updatedProducts} actualizados` : '';
            const msg = `CSV importado: ${result.data.imported.categories} categorías, ${result.data.imported.products} productos nuevos${updatedProducts}`;
            showToast(msg);
            document.getElementById('csvFile').value = '';
            loadCategoryList();
            loadProductList();
            loadProductCategoryDropdown();
        } else {
            showApiError(result, 'IMPORTAR CSV');
        }
    };
    reader.readAsText(file);
}

// ===== TAB 2: INVENTARIO =====
async function loadInventory() {
    const container = document.getElementById('inventoryContent');

    if (!selectedWarehouseId) {
        container.innerHTML = noWarehouseMsg();
        return;
    }

    const catResult = await apiFetch(`/warehouses/${selectedWarehouseId}/categories`);
    const categories = catResult.ok ? catResult.data : [];

    const catOptions = '<option value="">Todas las categorías</option>' +
        categories.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('');

    container.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div class="flex flex-wrap gap-4 flex-1">
                <div class="flex-1 min-w-[240px]">
                    <input type="text" id="invSearch" placeholder="🔍 Buscar producto..." class="input-field" oninput="debounceInventoryFilter()">
                </div>
                <div class="min-w-[200px]">
                    <select id="invCategory" class="input-field" onchange="filterInventory()">${catOptions}</select>
                </div>
            </div>
            <button onclick="setStartOfDay()" class="px-5 py-2.5 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded-xl hover:bg-indigo-600/40 hover:text-indigo-300 font-bold transition-all shadow-lg flex items-center gap-2">
                <i class="fa-solid fa-flag"></i> Definir como Inicio
            </button>
        </div>
        <div id="invTable"></div>
    `;

    filterInventory();
}

function debounceInventoryFilter() {
    clearTimeout(inventoryFilterTimeout);
    inventoryFilterTimeout = setTimeout(() => {
        filterInventory();
    }, 180);
}

async function filterInventory() {
    if (!selectedWarehouseId) return;

    const search = document.getElementById('invSearch').value.toLowerCase();
    const categoryId = document.getElementById('invCategory').value;

    let url = `/inventory?warehouseId=${selectedWarehouseId}`;
    if (categoryId) url += `&categoryId=${categoryId}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const result = await apiFetch(url);
    if (!result.ok) return;

    const products = result.data;

    if (!products.length) {
        document.getElementById('invTable').innerHTML = '<div class="text-center py-20 bg-[#15151D] border border-zinc-800 rounded-2xl text-zinc-500 font-medium">No se encontraron productos.</div>';
        return;
    }

    document.getElementById('invTable').innerHTML = `
        <div class="overflow-hidden rounded-xl border border-zinc-800 bg-[#15151D] shadow-sm">
            <table class="w-full text-left border-collapse table-compact">
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Categoría</th>
                        <th>Descripción</th>
                        <th class="text-center">Stock</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
                            <td class="font-bold text-zinc-200">${p[1]}</td>
                            <td class="text-indigo-400 font-medium">${p[5]}</td>
                            <td class="text-zinc-500">${p[2] || '-'}</td>
                            <td class="text-center">
                                <span class="inline-block px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-extrabold cursor-pointer hover:bg-indigo-500 hover:text-white transition-all transform hover:scale-110" 
                                      onclick="enableEditStock(${p[0]}, ${p[3]}, this)" title="Click para editar">
                                    ${p[3]}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function enableEditStock(productId, currentStock, element) {
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'flex items-center justify-center gap-1';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentStock;
    input.min = '0';
    input.className = 'w-16 px-2 py-1 bg-[#0D0D12] text-white border-2 border-indigo-500 rounded text-center text-sm font-bold focus:outline-none';
    
    const btnSave = document.createElement('button');
    btnSave.innerHTML = '<i class="fa-solid fa-check"></i>';
    btnSave.className = 'w-7 h-7 flex items-center justify-center bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/40 transition-colors text-xs cursor-pointer';
    btnSave.onclick = () => saveStockChange(productId, input.value, element, inputWrapper);
    
    const btnCancel = document.createElement('button');
    btnCancel.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btnCancel.className = 'w-7 h-7 flex items-center justify-center bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700 transition-colors text-xs cursor-pointer';
    btnCancel.onclick = () => {
        element.style.display = 'inline-block';
        inputWrapper.remove();
    };
    
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(btnSave);
    inputWrapper.appendChild(btnCancel);
    
    element.style.display = 'none';
    element.parentElement.appendChild(inputWrapper);
    input.focus();
    input.select();
    
    input.onkeydown = (e) => {
        if (e.key === 'Enter') saveStockChange(productId, input.value, element, inputWrapper);
        else if (e.key === 'Escape') {
            element.style.display = 'inline-block';
            inputWrapper.remove();
        }
    };
}

async function saveStockChange(productId, newQuantity, badgeElement, inputWrapper) {
    const quantity = parseInt(newQuantity);
    
    if (isNaN(quantity) || quantity < 0) {
        showToast('Cantidad inválida', 'error');
        badgeElement.style.display = 'inline-block';
        inputWrapper.remove();
        return;
    }
    
    const result = await apiFetch(`/products/${productId}/quantity`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity })
    });
    
    if (result.ok) {
        badgeElement.textContent = quantity;
        badgeElement.style.display = 'inline-block';
        inputWrapper.remove();
        showToast(`✓ Stock actualizado: ${result.data.quantity.old} → ${result.data.quantity.new}`);
        setTimeout(filterInventory, 300);
    } else {
        showApiError(result, 'ACTUALIZAR STOCK');
        badgeElement.style.display = 'inline-block';
        inputWrapper.remove();
    }
}

async function setStartOfDay() {
    if (!selectedWarehouseId) return showToast('Selecciona un almacén primero', 'error');
    if (!confirm('¿Deseas definir el inventario actual como el inicio del día?\\n\\nEsto fijará las cantidades actuales como el balance inicial, moviendo los ajustes manuales de hoy. Útil después de actualizar el stock global.')) return;

    const result = await apiFetch(`/warehouses/${selectedWarehouseId}/set-start-of-day`, {
        method: 'POST'
    });

    if (result.ok) {
        showToast('✓ Balance inicial de hoy definido correctamente');
    } else {
        showApiError(result, 'DEFINIR INICIO');
    }
}

// ===== TAB 3: MOVIMIENTOS =====
let moveProductCache = [];
let selectedProducts = [];

async function loadMovementsTab() {
    const container = document.getElementById('movementsContent');

    if (!selectedWarehouseId) {
        container.innerHTML = noWarehouseMsg();
        return;
    }

    const today = getLocalDateString();
    const [result, movResult] = await Promise.all([
        apiFetch(`/inventory?warehouseId=${selectedWarehouseId}`),
        apiFetch(`/movements?warehouseId=${selectedWarehouseId}&limit=10&date=${today}`)
    ]);

    moveProductCache = result.ok ? result.data : [];
    const recentMovements = movResult.ok ? movResult.data : [];

    selectedProducts = [];

    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="card p-6 bg-[#15151D] border border-zinc-800 shadow-sm relative">
                <h4 class="text-lg font-bold text-white mb-6 flex items-center gap-3">
                    <span class="w-8 h-8 flex items-center justify-center bg-indigo-500/20 text-indigo-400 rounded-lg"><i class="fa-solid fa-pen-to-square"></i></span> Registrar Movimiento
                </h4>
                <div class="mb-6 relative">
                    <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Buscar Producto</label>
                    <input type="text" id="moveProductSearch" placeholder="Buscar producto..." class="input-field shadow-sm bg-[#0D0D12] text-white" oninput="searchMoveProduct()" onkeydown="handleSearchKey(event)" onfocus="searchMoveProduct()" onblur="setTimeout(() => { document.getElementById('moveProductResults').innerHTML = ''; }, 200)" autocomplete="off">
                    <p class="text-[9px] text-zinc-500 font-bold mt-1.5 ml-1"><i class="fa-solid fa-circle-info text-indigo-500 mr-1"></i> Puedes buscar y agregar varios productos antes de confirmar.</p>
                    <div id="moveProductResults" class="absolute left-0 right-0 top-[60px] mt-1 z-[100]"></div>
                </div>
                
                <div id="selectedProductsList" class="mb-6 space-y-2"></div>
                
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Tipo</label>
                        <div class="flex items-center justify-between h-[42px] bg-[#0D0D12] border border-zinc-800 rounded-xl px-4 select-none">
                            <span class="text-xs font-bold text-zinc-500 transition-colors" id="lblEntrada">Entrada</span>
                            <label class="relative inline-flex items-center cursor-pointer mx-2">
                                <input type="checkbox" id="moveType" value="exit" checked class="sr-only peer" tabindex="-1" 
                                    onchange="
                                        const isExit = this.checked;
                                        const ent = document.getElementById('lblEntrada');
                                        const sal = document.getElementById('lblSalida');
                                        
                                        ent.classList.toggle('text-emerald-400', !isExit);
                                        ent.classList.toggle('drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]', !isExit);
                                        ent.classList.toggle('text-zinc-500', isExit);
                                        
                                        sal.classList.toggle('text-rose-400', isExit);
                                        sal.classList.toggle('drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]', isExit);
                                        sal.classList.toggle('text-zinc-500', !isExit);
                                    ">
                                <div class="w-10 h-5 bg-emerald-500/20 rounded-full border border-emerald-500/30 peer-checked:bg-rose-500/20 peer-checked:border-rose-500/30 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-emerald-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-rose-400"></div>
                            </label>
                            <span class="text-xs font-bold text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)] transition-colors" id="lblSalida">Salida</span>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Notas</label>
                        <input type="text" id="moveNotes" placeholder="Ej: Venta" class="input-field shadow-sm">
                    </div>
                </div>
                <button id="btnConfirmMovement" class="btn btn-success w-full py-3 text-sm" onclick="registerMovement()"><i class="fa-solid fa-check mr-2"></i> Confirmar Movimiento</button>
            </div>

            <div class="space-y-6">
                <h3 class="text-lg font-bold text-white flex items-center gap-3">
                    <span class="w-8 h-8 flex items-center justify-center bg-emerald-500/20 text-emerald-400 rounded-lg"><i class="fa-regular fa-clock"></i></span> Recientes (Hoy)
                </h3>
                ${recentMovements.length ? `
                    <div class="space-y-3">
                        ${recentMovements.map(m => `
                            <div class="p-4 bg-[#15151D] rounded-2xl border border-zinc-800 shadow-sm flex items-center justify-between">
                                <div class="flex items-center gap-4">
                                    <div class="w-10 h-10 rounded-xl flex items-center justify-center font-black ${m[1] === 'entry' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                                        ${m[1] === 'entry' ? '<i class="fa-solid fa-arrow-down"></i>' : '<i class="fa-solid fa-arrow-up"></i>'}
                                    </div>
                                    <div>
                                        <div class="font-bold text-zinc-200">${m[5]}</div>
                                        <div class="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">${m[3]}</div>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="text-lg font-black ${m[1] === 'entry' ? 'text-emerald-400' : 'text-rose-400'}">
                                        ${m[1] === 'entry' ? '+' : '-'}${m[2]}
                                    </div>
                                    <div class="text-[10px] text-zinc-500">${m[4] || '-'}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="text-center py-12 text-zinc-500">No hay movimientos recientes.</div>'}
            </div>
        </div>
    `;
}

function searchMoveProduct() {
    const searchInput = document.getElementById('moveProductSearch');
    if (!searchInput) return;
    
    const query = searchInput.value.toLowerCase().trim();
    const resultsContainer = document.getElementById('moveProductResults');

    // Muestra todos si esta vacio, o filtra por la busqueda
    filteredSearchProducts = query 
        ? moveProductCache.filter(p => p[1].toLowerCase().includes(query))
        : [...moveProductCache];

    selectedSearchIdx = filteredSearchProducts.length > 0 ? 0 : -1;
    
    if (filteredSearchProducts.length === 0 && !query) {
       resultsContainer.innerHTML = '';
       return;
    }
    
    renderSearchResults();
}

function renderSearchResults() {
    const resultsContainer = document.getElementById('moveProductResults');
    if (!filteredSearchProducts.length) {
        resultsContainer.innerHTML = `
            <div class="border border-zinc-700 rounded-lg p-3 shadow-2xl text-zinc-500 text-xs italic relative z-[100]" style="background-color: #15151D;">
                No se encontraron productos...
            </div>`;
        return;
    }

    resultsContainer.innerHTML = `
        <div class="border border-zinc-700 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,1)] max-h-60 overflow-y-auto divide-y divide-zinc-800/50 overflow-hidden relative z-[100]" style="background-color: #15151D;">
            ${filteredSearchProducts.map((p, idx) => `
                <div data-search-result="${idx}" class="p-2 cursor-pointer transition-colors flex justify-between items-center group ${idx === selectedSearchIdx ? 'bg-indigo-500/20 border-l-2 border-indigo-400' : 'hover:bg-zinc-800/80'}"
                     onmousedown="selectMoveProduct(${p[0]}, \`${p[1].replace(/`/g, '\\`')}\`, ${p[3]}, \`${p[5].replace(/`/g, '\\`')}\`)">
                    <div class="${idx === selectedSearchIdx ? 'ml-1' : 'ml-1.5'} transition-all">
                        <div class="font-bold text-sm ${idx === selectedSearchIdx ? 'text-indigo-300' : 'text-zinc-200'}">${p[1]}</div>
                        <div class="text-[9px] text-zinc-500 font-bold uppercase">📁 ${p[5]}</div>
                    </div>
                    <div class="text-[10px] font-black text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded-md border border-zinc-700">Stock: ${p[3]}</div>
                </div>
            `).join('')}
        </div>
    `;
    
    // Mantiene visible el elemento activo al navegar con las flechas.
    if (selectedSearchIdx >= 0 && selectedSearchIdx < filteredSearchProducts.length) {
        const selectedElem = resultsContainer.querySelector(`[data-search-result="${selectedSearchIdx}"]`);
        if (selectedElem) {
            requestAnimationFrame(() => {
                selectedElem.scrollIntoView({ block: 'nearest' });
            });
        }
    }
}

function handleSearchKey(e) {
    if (e.key === 'Escape') {
        document.getElementById('moveProductResults').innerHTML = '';
        selectedSearchIdx = -1;
        return;
    }

    if (!filteredSearchProducts.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedSearchIdx = (selectedSearchIdx + 1) % filteredSearchProducts.length;
        renderSearchResults();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedSearchIdx = (selectedSearchIdx - 1 + filteredSearchProducts.length) % filteredSearchProducts.length;
        renderSearchResults();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedSearchIdx >= 0 && filteredSearchProducts[selectedSearchIdx]) {
            const p = filteredSearchProducts[selectedSearchIdx];
            selectMoveProduct(p[0], p[1], p[3], p[5]);
        }
    }
}

function selectMoveProduct(id, name, stock, category) {
    if (selectedProducts.find(p => p.productId === id)) {
        showToast('Este producto ya está en la lista', 'error');
        return;
    }

    selectedProducts.push({ productId: id, name, stock, quantity: 1 });
    document.getElementById('moveProductSearch').value = '';
    document.getElementById('moveProductResults').innerHTML = '';
    selectedSearchIdx = -1;
    filteredSearchProducts = [];
    renderSelectedProducts();
    
    // Auto-focus the quantity input of the newly added product
    setTimeout(() => {
        const inputs = document.querySelectorAll('#selectedProductsList input[type="number"]');
        if (inputs.length > 0) {
            const lastInput = inputs[inputs.length - 1];
            lastInput.focus();
            lastInput.select();
        }
    }, 50);
}

function renderSelectedProducts() {
    const container = document.getElementById('selectedProductsList');
    if (!selectedProducts.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="bg-transparent mb-2">
            <div class="flex justify-between items-center mb-3">
                <span class="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> Seleccionados (${selectedProducts.length})</span>
                <button class="text-[10px] font-bold text-rose-500 uppercase hover:underline" onclick="clearAllProducts()">Limpiar todo</button>
            </div>
            <div class="space-y-2">
                ${selectedProducts.map((p, idx) => `
                    <div class="flex items-center justify-between p-3 bg-[#1A1A24] rounded-xl border border-zinc-800">
                        <div class="flex-1">
                            <div class="font-bold text-zinc-200 text-sm truncate pr-2">${p.name}</div>
                            <div class="text-[10px] text-zinc-500 font-bold uppercase">Stock: ${p.stock}</div>
                        </div>
                        <div class="flex items-center gap-3">
                            <input type="number" value="${p.quantity}" min="1" 
                                   onchange="updateProductQty(${idx}, this.value)"
                                   onkeydown="if(event.key === 'Enter') { event.preventDefault(); document.getElementById('btnConfirmMovement').focus(); }"
                                   class="w-16 px-2 py-1.5 bg-[#0D0D12] border border-zinc-700 rounded-lg text-center text-sm font-black focus:ring-1 focus:ring-indigo-500 outline-none text-white focus:border-indigo-500 transition-colors">
                            <button class="w-8 h-8 flex items-center justify-center text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20" onclick="removeProduct(${idx})">✕</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function updateProductQty(idx, qty) {
    selectedProducts[idx].quantity = parseInt(qty) || 1;
}

function removeProduct(idx) {
    selectedProducts.splice(idx, 1);
    renderSelectedProducts();
}

function clearAllProducts() {
    selectedProducts = [];
    renderSelectedProducts();
}

async function registerMovement() {
    const typeElem = document.getElementById('moveType');
    const type = typeElem.type === 'checkbox' ? (typeElem.checked ? 'exit' : 'entry') : typeElem.value;
    const notes = document.getElementById('moveNotes').value.trim();

    if (selectedProducts.length === 0) {
        return showToast('Agrega al menos un producto', 'error');
    }

    for (const p of selectedProducts) {
        if (p.quantity <= 0) return showToast(`Cantidad inválida para "${p.name}"`, 'error');
        if (type === 'exit' && p.quantity > p.stock) return showToast(`Stock insuficiente para "${p.name}". Stock actual: ${p.stock}`, 'error');
    }

    const products = selectedProducts.map(p => ({ productId: p.productId, quantity: p.quantity }));
    const result = await apiFetch('/movements', {
        method: 'POST',
        body: JSON.stringify({ products, type, notes })
    });

    if (result.ok) {
        showToast('✓ Movimiento registrado');
        selectedProducts = [];
        document.getElementById('moveNotes').value = '';
        loadMovementsTab();
    } else {
        showApiError(result, 'REGISTRAR MOVIMIENTO');
    }
}

// ===== TAB 4: HISTORIAL =====
let selectedHistoryDate = getLocalDateString();

async function loadHistory() {
    const container = document.getElementById('historyContent');

    if (!selectedWarehouseId) {
        container.innerHTML = noWarehouseMsg();
        return;
    }

    container.innerHTML = `
        <div id="historyHeader" class="mb-4 p-4 bg-[#15151D] rounded-xl border border-zinc-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h3 class="text-base font-bold text-white">Historial Detallado</h3>
                <p class="text-[11px] text-zinc-500 font-medium">Consulta el registro individual de cada movimiento.</p>
            </div>
            <div id="historyFilterControls" class="flex items-end gap-2">
                <div class="relative">
                    <label class="block text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1 ml-1">Fecha</label>
                    <input type="date" id="historyDatePicker" value="${selectedHistoryDate}" onchange="updateHistoryDate(this.value)" 
                           class="input-field py-1.5 px-3 bg-[#0D0D12] text-zinc-300 border-zinc-800 shadow-sm">
                </div>
                <button onclick="setHistoryToday()" class="bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-indigo-500 hover:text-white transition-all border border-indigo-500/20">Hoy</button>
            </div>
        </div>
        <div id="historyTableContainer"></div>
    `;

    await refreshHistoryTable();
}

async function updateHistoryDate(newDate) {
    selectedHistoryDate = newDate;
    await refreshHistoryTable();
}

async function setHistoryToday() {
    selectedHistoryDate = getLocalDateString();
    const picker = document.getElementById('historyDatePicker');
    if (picker) picker.value = selectedHistoryDate;
    await refreshHistoryTable();
}

async function refreshHistoryTable() {
    const container = document.getElementById('historyTableContainer');
    const result = await apiFetch(`/movements?warehouseId=${selectedWarehouseId}&date=${selectedHistoryDate}`);
    if (!result.ok) return;

    const movements = result.data;

    if (!movements.length) {
        container.innerHTML = '<div class="text-center py-12 text-zinc-500 font-medium bg-[#15151D] border border-zinc-800 rounded-xl shadow-sm">No hay movimientos en esta fecha.</div>';
        return;
    }

    container.innerHTML = `
        <div id="historyTableWrapper" class="overflow-hidden rounded-xl border border-zinc-800 bg-[#15151D] shadow-sm">
            <table class="w-full text-left border-collapse table-compact">
                <thead>
                    <tr>
                        <th class="text-center">Hora/ID</th>
                        <th>Producto</th>
                        <th class="text-center">Tipo</th>
                        <th class="text-center">Cant.</th>
                        <th>Notas</th>
                        <th class="text-center">Acción</th>
                    </tr>
                </thead>
                <tbody>
                    ${movements.map(m => `
                        <tr>
                            <td class="text-center text-[10px] text-zinc-500 font-mono">#${m[0]}</td>
                            <td class="font-bold text-zinc-200">${m[5]}</td>
                            <td class="text-center">
                                <span class="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${m[1] === 'entry' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                                    ${m[1] === 'entry' ? 'Entrada' : 'Salida'}
                                </span>
                            </td>
                            <td class="text-center font-bold text-zinc-300 border-x border-zinc-800/50">${m[2]}</td>
                            <td class="text-xs text-zinc-500 max-w-xs truncate" title="${m[4] || ''}">${m[4] || '-'}</td>
                            <td class="text-center">
                                <button class="w-7 h-7 flex items-center mx-auto justify-center bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 hover:text-rose-300 transition-colors" onclick="deleteMovement(${m[0]})"><i class="fa-solid fa-trash-can text-xs"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function deleteMovement(id) {
    if (!confirm('¿Eliminar este movimiento? Se revertirá el stock del producto.')) return;
    const result = await apiFetch(`/movements/${id}`, { method: 'DELETE' });
    if (result.ok) {
        showToast(result.data.message || 'Movimiento eliminado. Stock revertido.');
        loadHistory();
        if (document.querySelector('.tab-btn-main.active[data-tab="inventory"]')) loadInventory();
    } else {
        showApiError(result, 'ELIMINAR MOVIMIENTO');
    }
}

// ===== TAB 5: RESUMEN =====
let selectedSummaryDate = getLocalDateString();

async function loadSummary() {
    const container = document.getElementById('summaryContent');

    if (!selectedWarehouseId) {
        container.innerHTML = noWarehouseMsg();
        return;
    }

    selectedSummaryDate = getLocalDateString();

    container.innerHTML = `
        <div id="summaryHeader" class="mb-4 p-4 bg-[#15151D] rounded-xl border border-zinc-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h3 class="text-base font-bold text-white">Cierre de Inventario</h3>
                <p class="text-[11px] text-zinc-500 font-medium">Stock acumulado por día.</p>
            </div>
            <div id="summaryFilterControls" class="flex items-end gap-2">
                <div class="relative">
                    <label class="block text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1 ml-1">Fecha</label>
                    <input type="date" id="summaryDatePicker" value="${selectedSummaryDate}" onchange="updateSummaryDate(this.value)" 
                           class="input-field py-1.5 px-3 bg-[#0D0D12] text-zinc-300 border-zinc-800 shadow-sm">
                </div>
                <button onclick="setSummaryToday()" class="bg-indigo-500/10 text-indigo-400 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-indigo-500 hover:text-white transition-all border border-indigo-500/20">Hoy</button>
            </div>
        </div>
        <div id="summaryTableContent"></div>
    `;

    await refreshSummaryTable();
}

async function setSummaryToday() {
    const today = getLocalDateString();
    const picker = document.getElementById('summaryDatePicker');
    if (picker) {
        picker.value = today;
        await updateSummaryDate(today);
    }
}

async function updateSummaryDate(newDate) {
    selectedSummaryDate = newDate;
    await refreshSummaryTable();
}

async function refreshSummaryTable() {
    const tableContent = document.getElementById('summaryTableContent');
    const result = await apiFetch(`/summary-by-date?warehouseId=${selectedWarehouseId}&date=${selectedSummaryDate}`);
    if (!result.ok) return showApiError(result, 'CARGAR RESUMEN');

    const products = result.data;
    if (!products.length) {
        tableContent.innerHTML = '<div class="text-center py-20 text-zinc-500 font-medium bg-[#15151D] border border-zinc-800 rounded-xl">No hay productos en este almacén.</div>';
        return;
    }

    tableContent.innerHTML = `
        <div id="summaryTableWrapper" class="overflow-hidden rounded-xl border border-zinc-800 bg-[#15151D] shadow-sm">
            <table class="w-full text-left border-collapse table-compact">
                <thead>
                    <tr>
                        <th class="text-zinc-400">Producto / Categoría</th>
                        <th class="text-center"><i class="fa-solid fa-location-dot mr-1 text-slate-500"></i> Inicio</th>
                        <th class="text-center text-emerald-400"><i class="fa-solid fa-arrow-down mr-1"></i> Entrada</th>
                        <th class="text-center text-rose-400"><i class="fa-solid fa-arrow-up mr-1"></i> Salida</th>
                        <th class="text-center text-white"><i class="fa-solid fa-chart-pie mr-1 text-indigo-400"></i> Final</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
                            <td>
                                <div class="font-bold text-zinc-200 leading-tight">${p[1]}</div>
                                <div class="text-[9px] text-zinc-500 font-bold uppercase mt-0.5"><i class="fa-solid fa-folder mr-1"></i> ${p[2]}</div>
                            </td>
                            <td class="text-center font-bold text-zinc-400">${p[3]}</td>
                            <td class="text-center font-black text-emerald-400">${p[4] > 0 ? '+' + p[4] : '0'}</td>
                            <td class="text-center font-black text-rose-400">${p[5] > 0 ? '-' + p[5] : '0'}</td>
                            <td class="text-center font-black text-white bg-[#101016] border-x border-zinc-800/50">${p[6]}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ===== INITIAL LOAD =====
loadWarehouseDropdown();
loadConfigTab();
