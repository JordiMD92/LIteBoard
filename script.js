// --- ESTADO GLOBAL ---
let haSocket = null;
let chartInstances = {};
let haStates = {}; // Almacena todos los estados
let haDevices = {}; // Almacena todos los devices
let haAreas = {}; // Almacena todas las areas
let haEntities = {}; // Almacena todas las entidades
let entities = {}; // Almacena la info de las entidades mergeada
let grid = null;
let messageId = 1;
let longPressTimer = null;
let isEditMode = true;
const DASHBOARDS_KEY = 'liteboard_data';
let appData = {
    dashboards: [],
    currentDashboard: 0
};

// --- CONFIGURACIÓN & INICIO ---
document.addEventListener("DOMContentLoaded", () => {
    const url = localStorage.getItem('ha_url');
    const token = localStorage.getItem('ha_token');
    grid = GridStack.init({
        cellHeight: 100,
        margin: 5,
        float: true
    });
    grid.on('change', saveLayout);
    grid.on('removed', (event, items) => {
        items.forEach(item => {
            const id = item.id;
            if (id && id.startsWith('graph-')) {
                const entityId = id.substring(6);
                const canvasId = `chart-${entityId}`;
                if (chartInstances[canvasId]) {
                    chartInstances[canvasId].destroy();
                    delete chartInstances[canvasId];
                }
            }
        });
        saveLayout();
    });
    grid.on('dragstart', function(event, el) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
    loadAppData();
    renderDashboardButtons();
    updateUIMode(); // Poner la UI en el estado inicial correcto
    if (url && token) {
        connectToHA(url, token);
    }
    // Cerrar menú de settings si se hace click fuera
    window.onclick = function(event) {
        if (!event.target.matches('.toolbar-btn')) {
            const dropdowns = document.getElementsByClassName("dropdown-content");
            for (let i = 0; i < dropdowns.length; i++) {
                dropdowns[i].classList.remove('show');
            }
        }
    }
});

function saveConfigAndConnect() {
    const url = document.getElementById('ha-url').value.replace(/\/$/, "");
    const token = document.getElementById('ha-token').value;
    if (!url || !token) return alert("Faltan datos");
    localStorage.setItem('ha_url', url);
    localStorage.setItem('ha_token', token);
    connectToHA(url, token);
}

function clearConfig() {
    if (confirm("¿Borrar toda la configuración (incluyendo dashboards)?")) {
        localStorage.clear();
        location.reload();
    }
}

// --- GESTIÓN DE DASHBOARDS ---
function loadAppData() {
    const data = localStorage.getItem(DASHBOARDS_KEY);
    const oldLayout = localStorage.getItem('my_dashboard_layout');
    if (data) {
        appData = JSON.parse(data);
    } else if (oldLayout) {
        appData.dashboards.push({ name: 'Principal', layout: JSON.parse(oldLayout) });
        localStorage.removeItem('my_dashboard_layout');
        saveAppData();
    } else {
        appData.dashboards.push({ name: 'Principal', layout: [] });
        saveAppData();
    }
}

function saveAppData() {
    localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(appData));
}

function renderDashboardButtons() {
    const container = document.getElementById('dashboard-buttons');
    container.innerHTML = '';
    appData.dashboards.forEach((dash, index) => {
        const button = document.createElement('button');
        button.className = 'dashboard-btn';
        button.innerText = dash.name;
        button.dataset.index = index;
        if (index === appData.currentDashboard) {
            button.classList.add('active');
        }
        button.onclick = () => switchDashboard(index);
        container.appendChild(button);
    });
}

function addDashboard() {
    const name = prompt("Nombre del nuevo dashboard:", `Dashboard ${appData.dashboards.length + 1}`);
    if (name) {
        appData.dashboards.push({ name: name, layout: [] });
        appData.currentDashboard = appData.dashboards.length - 1;
        saveAppData();
        renderDashboardButtons();
        loadDashboardLayout();
    }
}

function deleteDashboard() {
    if (appData.dashboards.length <= 1) {
        return alert("No puedes borrar el único dashboard existente.");
    }
    if (confirm(`¿Seguro que quieres borrar el dashboard "${appData.dashboards[appData.currentDashboard].name}"?`)) {
        appData.dashboards.splice(appData.currentDashboard, 1);
        appData.currentDashboard = 0;
        saveAppData();
        renderDashboardButtons();
        loadDashboardLayout();
    }
}

function switchDashboard(newIndex) {
    appData.currentDashboard = newIndex;
    saveAppData();
    renderDashboardButtons(); // Re-render para actualizar el estado activo
    loadDashboardLayout();
}

// --- LÓGICA DE UI ---
function toggleSettingsMenu() {
    document.getElementById("settings-dropdown").classList.toggle("show");
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    grid.setStatic(!isEditMode);
    updateUIMode();
}

function updateUIMode() {
    const lockBtn = document.getElementById('lock-btn');
    const addEntityBtn = document.getElementById('add-entity-btn');
    const addCameraBtn = document.getElementById('add-camera-btn');
    const addGraphBtn = document.getElementById('add-graph-btn');
    const mainUI = document.getElementById('main-ui');
    if (isEditMode) {
        lockBtn.innerText = 'Bloquear';
        addEntityBtn.style.display = 'block';
        addCameraBtn.style.display = 'block';
        addGraphBtn.style.display = 'block';
        mainUI.classList.remove('locked');
    } else {
        lockBtn.innerText = 'Desbloquear';
        addEntityBtn.style.display = 'none';
        addCameraBtn.style.display = 'none';
        addGraphBtn.style.display = 'none';
        mainUI.classList.add('locked');
    }
}

// --- WEBSOCKET HOME ASSISTANT ---
function connectToHA(url, token) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-ui').style.display = 'block';
    const wsUrl = url.replace('http', 'ws') + '/api/websocket';
    haSocket = new WebSocket(wsUrl);
    haSocket.onopen = () => console.log("Conectado WS");
    haSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_required') {
            haSocket.send(JSON.stringify({ type: 'auth', access_token: token }));
        } else if (data.type === 'auth_ok') {
            console.log("Auth OK");
            loadDashboardLayout();
            haSocket.send(JSON.stringify({ id: messageId++, type: 'subscribe_events', event_type: 'state_changed' }));
            const statePromise = new Promise(resolve => {
                const id = messageId++;
                haSocket.send(JSON.stringify({ id, type: 'get_states' }));
                const onResult = (e) => {
                    const d = JSON.parse(e.data);
                    if (d.id === id) {
                        d.result.forEach(entity => { haStates[entity.entity_id] = entity; });
                        haSocket.removeEventListener('message', onResult);
                        resolve();
                    }
                };
                haSocket.addEventListener('message', onResult);
            });
            const areaPromise = new Promise(resolve => {
                const id = messageId++;
                haSocket.send(JSON.stringify({ id, type: 'config/area_registry/list' }));
                const onResult = (e) => {
                    const d = JSON.parse(e.data);
                    if (d.id === id) {
                        d.result.forEach(area => { haAreas[area.area_id] = area; });
                        haSocket.removeEventListener('message', onResult);
                        resolve();
                    }
                };
                haSocket.addEventListener('message', onResult);
            });
            const devicePromise = new Promise(resolve => {
                const id = messageId++;
                haSocket.send(JSON.stringify({ id, type: 'config/device_registry/list' }));
                 const onResult = (e) => {
                    const d = JSON.parse(e.data);
                    if (d.id === id) {
                        d.result.forEach(device => { haDevices[device.id] = device; });
                        haSocket.removeEventListener('message', onResult);
                        resolve();
                    }
                };
                haSocket.addEventListener('message', onResult);
            });
            const entityPromise = new Promise(resolve => {
                const id = messageId++;
                haSocket.send(JSON.stringify({ id, type: 'config/entity_registry/list' }));
                 const onResult = (e) => {
                    const d = JSON.parse(e.data);
                    if (d.id === id) {
                        d.result.forEach(entity => { haEntities[entity.entity_id] = entity; });
                        haSocket.removeEventListener('message', onResult);
                        resolve();
                    }
                };
                haSocket.addEventListener('message', onResult);
            });
            Promise.all([statePromise, areaPromise, devicePromise, entityPromise]).then(() => {
                buildFullEntities();
                Object.keys(haStates).forEach(id => updateWidgetUI(id));
            });
        } else if (data.type === 'event' && data.event.event_type === 'state_changed') {
            const newState = data.event.data.new_state;
            if (newState) {
                haStates[newState.entity_id] = newState;
                updateWidgetUI(newState.entity_id);
            }
        }
    };
    haSocket.onclose = () => {
        console.log("Desconectado. Reintentando en 5s...");
        setTimeout(() => connectToHA(url, token), 5000);
    };
}

function buildFullEntities() {
    entities = {};
    for (const entityId in haStates) {
        const entityState = haStates[entityId];
        const entityInfo = haEntities[entityId];
        const device = entityInfo ? haDevices[entityInfo.device_id] : null;
        const area = device ? haAreas[device.area_id] : null;
        entities[entityId] = {
            ...entityState,
            entity_info: entityInfo,
            device: device,
            area: area,
            domain: entityId.split('.')[0]
        };
    }
}

// --- GESTIÓN DE SERVICIOS (ACCIONES) ---
function callService(domain, service, serviceData) {
    haSocket.send(JSON.stringify({
        id: messageId++,
        type: 'call_service',
        domain: domain,
        service: service,
        service_data: serviceData
    }));
}

function callServiceWithResult(domain, service, target, service_data) {
    return new Promise((resolve, reject) => {
        const id = messageId++;
        const onResult = (e) => {
            const d = JSON.parse(e.data);
            if (d.id === id) {
                haSocket.removeEventListener('message', onResult);
                if (d.success) {
                    resolve(d.result);
                } else {
                    reject(d.error);
                }
            }
        };
        haSocket.addEventListener('message', onResult);

        const message = {
            id: id,
            type: 'call_service',
            domain: domain,
            service: service,
            target: target,
            return_response: true
        };

        if (service_data) {
            message.service_data = service_data;
        }

        haSocket.send(JSON.stringify(message));
    });
}

// --- LÓGICA DEL GRID & WIDGETS ---
function addDeleteButton(widgetElement) {
    const contentElement = widgetElement.querySelector('.grid-stack-item-content');
    if (!contentElement || contentElement.querySelector('.delete-widget-btn')) return;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-widget-btn';
    deleteBtn.innerHTML = '&times;'; // A nice 'x' icon
    deleteBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent triggering other widget events
        if (confirm(`¿Seguro que quieres eliminar este widget?`)) {
            grid.removeWidget(widgetElement);
        }
    };
    contentElement.appendChild(deleteBtn);
}

function loadDashboardLayout() {
    const currentDashboard = appData.dashboards[appData.currentDashboard];
    grid.removeAll();
    if (currentDashboard && currentDashboard.layout.length > 0) {
        grid.load(currentDashboard.layout);
    }
    setTimeout(() => {
        const currentDashboard = appData.dashboards[appData.currentDashboard];
        if (!currentDashboard) return;
        document.querySelectorAll('.grid-stack-item').forEach(item => {
            const widgetId = item.getAttribute('gs-id');
            const widgetData = currentDashboard.layout.find(w => w.id === widgetId);
            if (!widgetData) return;
            const content = item.querySelector('.grid-stack-item-content');
            if (!content) return;

            const domain = widgetId.split('.')[0];

            if (widgetId.startsWith('camera-') && widgetData.url) {
                // This is a camera widget
                item.dataset.url = widgetData.url; // restore url to dataset
                const video = document.createElement('video-stream');
                video.src = widgetData.url;
                video.style.height = '100%';
                video.style.width = '100%';
                content.innerHTML = '';
                content.appendChild(video);
                // Add long-press event listener for editing
                content.onmousedown = (e) => handleCameraStart(e, widgetId);
                content.ontouchstart = (e) => handleCameraStart(e, widgetId);
                content.onmouseup = (e) => handleCameraEnd(e);
                content.ontouchend = (e) => handleCameraEnd(e);
            } else if (widgetId.startsWith('graph-')) {
                const entityId = widgetId.substring(6);
                renderGraphWidgetContent(content, entityId);
            } else if (domain === 'weather') {
                renderWeatherWidgetContent(content, widgetId);
            }
            else if (!widgetId.startsWith('camera-')) {
                // This is an entity widget
                renderWidgetContent(content, widgetId);
            }
        });
        document.querySelectorAll('.grid-stack-item').forEach(addDeleteButton);
    }, 100);
}

function saveLayout() {
    if (appData.dashboards[appData.currentDashboard]) {
        const layout = [];
        grid.engine.nodes.forEach(node => {
            const widgetData = {
                x: node.x,
                y: node.y,
                w: node.w,
                h: node.h,
                id: node.id,
            };
            if (node.id && node.id.startsWith('camera-')) {
                // Get the URL from the dataset
                widgetData.url = node.el.dataset.url;
            }
            layout.push(widgetData);
        });
        appData.dashboards[appData.currentDashboard].layout = layout;
        saveAppData();
    }
}

function addWidget(entityId) {
    const domain = entityId.split('.')[0];
    if (domain === 'weather') {
        addWeatherWidget(entityId);
    } else {
        const newWidgetEl = grid.addWidget({ w: 2, h: 2, id: entityId, content: '' });
        const el = newWidgetEl.querySelector('.grid-stack-item-content');
        renderWidgetContent(el, entityId);
        addDeleteButton(newWidgetEl);
        closeModal('add-modal');
        saveLayout();
    }
}

function addWeatherWidget(entityId) {
    const newWidgetEl = grid.addWidget({ w: 2, h: 3, id: entityId, content: '' });
    const el = newWidgetEl.querySelector('.grid-stack-item-content');
    renderWeatherWidgetContent(el, entityId);
    addDeleteButton(newWidgetEl);
    closeModal('add-modal');
    saveLayout();
}

function renderWidgetContent(container, entityId) {
    if (!container) return;
    const entity = haStates[entityId];
    const name = (entity && entity.attributes.friendly_name) || entityId;
    container.innerHTML = `
        <div class="entity-icon" id="icon-${entityId}">Checking...</div>
        <div class="entity-name">${name}</div>
        <div class="entity-state" id="state-${entityId}">...</div>
    `;
    container.onmousedown = (e) => handleStart(e, entityId);
    container.ontouchstart = (e) => handleStart(e, entityId);
    container.onmouseup = (e) => handleEnd(e, entityId);
    container.ontouchend = (e) => handleEnd(e, entityId);
    updateWidgetUI(entityId);
}

// --- INTERACCIÓN (CLICK vs LONG PRESS) ---
function handleStart(e, entityId) {
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        openEntityDetails(entityId);
    }, 600);
}

function handleEnd(e, entityId) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        if (!isEditMode) handleTap(entityId);
    }
}

function handleTap(entityId) {
    if (isEditMode && grid.engine.nodes.find(n => n.id === entityId)?._isDragging) return;
    const domain = entityId.split('.')[0];
    if (domain === 'light' || domain === 'switch') {
        callService(domain, 'toggle', { entity_id: entityId });
    }
}

// --- ACTUALIZACIÓN DE UI ---
function updateWidgetUI(entityId) {
    const stateEl = document.getElementById(`state-${entityId}`);
    const iconEl = document.getElementById(`icon-${entityId}`);
    const graphStateEl = document.getElementById(`state-graph-${entityId}`);
    const entity = haStates[entityId];
    if (!entity) return;

    const domain = entityId.split('.')[0];
    if (domain === 'weather') {
        updateWeatherWidgetUI(entityId);
        return;
    }

    if (stateEl) {
        const state = entity.state;

        if ((domain === 'light' || domain === 'switch') && (state === 'on' || state === 'off')) {
            stateEl.innerText = '';
        } else {
            let stateText = state;
            if (entity.attributes.unit_of_measurement) {
                stateText += ` ${entity.attributes.unit_of_measurement}`;
            }
            stateEl.innerText = stateText;
        }
    }

    if (graphStateEl) {
        const numericState = parseFloat(entity.state);
        if (!isNaN(numericState)) {
            let stateText = numericState.toFixed(2);
            if (entity.attributes.unit_of_measurement) {
                stateText += ` ${entity.attributes.unit_of_measurement}`;
            }
            graphStateEl.innerText = stateText;
        }
    }

    if (iconEl) {
        const widgetContent = iconEl.parentElement;
        if (entity.attributes.icon) {
            const iconName = entity.attributes.icon.split(':')[1];
            iconEl.innerHTML = `<span class="mdi mdi-${iconName}" style="font-size: 28px; line-height: 1;"></span>`;
        } else {
            const domain = entityId.split('.')[0];
            let icon = "❓";
            if (domain === 'light') icon = "💡";
            if (domain === 'switch') icon = "🔌";
            if (domain === 'sensor') icon = "🌡️";
            iconEl.innerText = icon;
        }
        if (widgetContent) {
            if (entity.state === 'on') {
                widgetContent.classList.add('active-state');
            } else {
                widgetContent.classList.remove('active-state');
            }
        }
    }
}

// --- MODALES Y LÓGICA DE LUZ ---
function openAddModal() {
    document.getElementById('add-modal').style.display = 'flex';
    populateFilters();
    renderEntityList();
}

function openAddGraphModal() {
    document.getElementById('add-graph-modal').style.display = 'flex';
    document.getElementById('graph-filter-input').value = '';
    renderGraphEntityList();
}

function renderGraphEntityList() {
    const list = document.getElementById('graph-entity-list');
    list.innerHTML = "";
    const filterText = document.getElementById('graph-filter-input').value.toLowerCase();
    const graphableEntities = Object.keys(entities).filter(id => {
        const entity = entities[id];
        const devClass = entity.attributes.device_class;
        const isGraphable = entity.domain === 'sensor' &&
            (devClass === 'power' || devClass === 'voltage' || devClass === 'current' || !isNaN(parseFloat(entity.state)));
        if (!isGraphable) return false;
        const friendlyName = entity.attributes.friendly_name || '';
        return id.toLowerCase().includes(filterText) || friendlyName.toLowerCase().includes(filterText);
    });
    graphableEntities.sort().forEach(id => {
        const entity = entities[id];
        const div = document.createElement('div');
        div.className = 'entity-list-item';
        let pathParts = [];
        if (entity.area && entity.area.name) pathParts.push(entity.area.name);
        if (entity.device && entity.device.name) pathParts.push(entity.device.name);
        const pathString = pathParts.join(' > ');
        div.innerHTML = `
            <div style="flex-grow: 1;">
                <strong>${entity.attributes.friendly_name || id}</strong>
                ${pathString ? `<br><small style="color: #999;">${pathString}</small>` : ''}
            </div>
            <button onclick="addGraphWidget('${id}')" style="margin-left: 10px;">Añadir Gráfico</button>
        `;
        list.appendChild(div);
    });
    if (graphableEntities.length === 0) {
        list.innerHTML = '<p>No se encontraron sensores con historial (clase: power, voltage, current) o con estado numérico.</p>';
    }
}

function addGraphWidget(entityId) {
    const widgetId = `graph-${entityId}`;
    const newWidgetEl = grid.addWidget({ w: 4, h: 3, id: widgetId, content: '' });
    const el = newWidgetEl.querySelector('.grid-stack-item-content');
    renderGraphWidgetContent(el, entityId);
    addDeleteButton(newWidgetEl);
    closeModal('add-graph-modal');
    saveLayout();
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function filterEntities() {
    const text = document.getElementById('filter-input').value.toLowerCase();
    const area = document.getElementById('filter-area').value;
    const device = document.getElementById('filter-device').value;
    const type = document.getElementById('filter-type').value;
    renderEntityList({ text, area, device, type });
}

function clearFilters() {
    document.getElementById('filter-input').value = '';
    document.getElementById('filter-area').value = '';
    document.getElementById('filter-device').value = '';
    document.getElementById('filter-type').value = '';
    filterEntities();
}

function populateFilters() {
    const areaSelect = document.getElementById('filter-area');
    const deviceSelect = document.getElementById('filter-device');
    const typeSelect = document.getElementById('filter-type');
    const areas = new Set();
    const devices = new Set();
    const types = new Set();
    for (const id in entities) {
        const entity = entities[id];
        if (entity.area) areas.add(entity.area.name);
        if (entity.device) devices.add(entity.device.name);
        types.add(entity.domain);
    }
    areaSelect.innerHTML = '<option value="">Toda las Areas</option>';
    [...areas].sort().forEach(area => {
        areaSelect.innerHTML += `<option value="${area}">${area}</option>`;
    });
    deviceSelect.innerHTML = '<option value="">Todos los Dispositivos</option>';
    [...devices].sort().forEach(device => {
        deviceSelect.innerHTML += `<option value="${device}">${device}</option>`;
    });
    typeSelect.innerHTML = '<option value="">Todos los Tipos</option>';
    [...types].sort().forEach(type => {
        typeSelect.innerHTML += `<option value="${type}">${type}</option>`;
    });
}

function renderEntityList(filters = {}) {
    const list = document.getElementById('entity-list');
    list.innerHTML = "";
    const { text = "", area = "", device = "", type = "" } = filters;
    Object.keys(entities).sort().forEach(id => {
        const entity = entities[id];
        if (
            (!text || id.toLowerCase().includes(text) || (entity.attributes.friendly_name && entity.attributes.friendly_name.toLowerCase().includes(text))) &&
            (!area || (entity.area && entity.area.name === area)) &&
            (!device || (entity.device && entity.device.name === device)) &&
            (!type || entity.domain === type)
        ) {
            const div = document.createElement('div');
            div.className = 'entity-list-item';
            let pathParts = [];
            if (entity.area && entity.area.name) pathParts.push(entity.area.name);
            if (entity.device && entity.device.name) pathParts.push(entity.device.name);
            const pathString = pathParts.join(' > ');
            let iconHtml = '';
            if (entity.attributes.icon) {
                const iconName = entity.attributes.icon.split(':')[1];
                iconHtml = `<span class="mdi mdi-${iconName}" style="margin-right: 10px; font-size: 1.2em; min-width: 24px;"></span>`;
            } else {
                const domain = entity.domain;
                let icon = "❓";
                if (domain === 'light') icon = "💡";
                if (domain === 'switch') icon = "🔌";
                if (domain === 'sensor') icon = "🌡️";
                if (domain === 'weather') icon = "🌦️";
                iconHtml = `<span style="margin-right: 10px; min-width: 24px;">${icon}</span>`;
            }
            div.innerHTML = `
                ${iconHtml}
                <div style="flex-grow: 1; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${entity.attributes.friendly_name || id}</strong>
                        ${pathString ? `<br><small style="color: #999;">${pathString}</small>` : ''}
                    </div>
                    <span style="background-color: #444; padding: 2px 6px; border-radius: 4px; font-size: 0.8em;">${entity.domain}</span>
                </div>
                <button onclick="addWidget('${id}')" style="margin-left: 10px;">Añadir</button>
            `;
            list.appendChild(div);
        }
    });
}

function openEntityDetails(entityId) {
    const entity = haStates[entityId];
    if (!entity || entityId.split('.')[0] !== 'light') return;
    const modal = document.getElementById('light-modal');
    document.getElementById('light-modal-title').innerText = entity.attributes.friendly_name || entityId;
    // Contenedores
    const brightnessContainer = document.getElementById('light-brightness-container');
    const tempContainer = document.getElementById('light-temp-container');
    const colorContainer = document.getElementById('light-color-container');
    // Controles
    const brightnessSlider = document.getElementById('light-brightness');
    const tempSlider = document.getElementById('light-color-temp');
    const colorPicker = document.getElementById('light-color-picker');
    const supportedModes = entity.attributes.supported_color_modes || [];
    // --- Brillo ---
    if (supportedModes.some(m => ['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m))) {
        brightnessContainer.style.display = 'block';
        brightnessSlider.value = entity.attributes.brightness || 0;
        brightnessSlider.oninput = (e) => {
            callService('light', 'turn_on', { entity_id: entityId, brightness: parseInt(e.target.value) });
        };
    } else {
        brightnessContainer.style.display = 'none';
    }
    // --- Temperatura de Color ---
    if (supportedModes.includes('color_temp')) {
        tempContainer.style.display = 'block';
        tempSlider.min = entity.attributes.min_mireds || 153;
        tempSlider.max = entity.attributes.max_mireds || 500;
        tempSlider.value = entity.attributes.color_temp || tempSlider.min;
        tempSlider.oninput = (e) => {
            callService('light', 'turn_on', { entity_id: entityId, color_temp: parseInt(e.target.value) });
        };
    } else {
        tempContainer.style.display = 'none';
    }
    // --- Color ---
    if (supportedModes.some(m => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m))) {
        colorContainer.style.display = 'block';
        if (entity.attributes.hs_color) {
            const rgb = hsToRgb(entity.attributes.hs_color[0], entity.attributes.hs_color[1]);
            colorPicker.value = rgbToHex(rgb[0], rgb[1], rgb[2]);
        } else {
            colorPicker.value = '#ffffff';
        }
        colorPicker.oninput = (e) => {
            const rgb = e.target.value.substring(1).match(/.{1,2}/g).map(v => parseInt(v, 16));
            callService('light', 'turn_on', { entity_id: entityId, rgb_color: rgb });
        };
    } else {
        colorContainer.style.display = 'none';
    }
    const btn = document.getElementById('light-toggle-btn');
    btn.onclick = () => {
        callService('light', 'toggle', { entity_id: entityId });
    };
    modal.style.display = 'flex';
}

function openAddCameraModal() {
    document.getElementById('add-camera-modal').style.display = 'flex';
}

function addCameraWidget() {
    const url = document.getElementById('camera-url-input').value;
    if (!url) {
        return alert('Por favor, introduce una URL para la cámara.');
    }
    const widgetId = `camera-${Date.now()}`;
    const newWidgetEl = grid.addWidget({
        w: 4, h: 3, id: widgetId,
    });
    addDeleteButton(newWidgetEl);
    // Store the url on the widget element's dataset. It's a good place.
    newWidgetEl.dataset.url = url;
    const content = newWidgetEl.querySelector('.grid-stack-item-content');
    if (content) {
        const video = document.createElement('video-stream');
        video.src = url;
        video.style.height = '100%';
        video.style.width = '100%';
        content.innerHTML = '';
        content.appendChild(video);
        // Add long-press event listener for editing
        content.onmousedown = (e) => handleCameraStart(e, widgetId);
        content.ontouchstart = (e) => handleCameraStart(e, widgetId);
        content.onmouseup = (e) => handleCameraEnd(e);
        content.ontouchend = (e) => handleCameraEnd(e);
    }
    closeModal('add-camera-modal');
    document.getElementById('camera-url-input').value = ''; // Clear input
    saveLayout(); // Important: save the new widget to the layout
}

// --- Helpers de Color ---
function hsToRgb(h, s) {
    s /= 100;
    let c = s;
    let x = c * (1 - Math.abs((h / 60) % 2 - 1));
    let m = 0;
    let rgb;
    if (h >= 0 && h < 60) rgb = [c, x, 0];
    else if (h >= 60 && h < 120) rgb = [x, c, 0];
    else if (h >= 120 && h < 180) rgb = [0, c, x];
    else if (h >= 180 && h < 240) rgb = [0, x, c];
    else if (h >= 240 && h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(v => Math.round((v + m) * 255));
}

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// --- INTERACCIÓN DE CÁMARA (LONG PRESS) ---
function handleCameraStart(e, widgetId) {
    if (!isEditMode) return; // No hacer nada si el modo edición está bloqueado
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        openEditCameraModal(widgetId);
    }, 600);
}

function handleCameraEnd(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

function openEditCameraModal(widgetId) {
    const widgetEl = grid.engine.nodes.find(n => n.id === widgetId)?.el;
    if (!widgetEl) return;
    const currentUrl = widgetEl.dataset.url;
    document.getElementById('edit-camera-url-input').value = currentUrl;
    document.getElementById('edit-camera-widget-id').value = widgetId;
    document.getElementById('edit-camera-modal').style.display = 'flex';
}

function updateCameraUrl() {
    const widgetId = document.getElementById('edit-camera-widget-id').value;
    const newUrl = document.getElementById('edit-camera-url-input').value;
    if (!widgetId || !newUrl) {
        return alert('Error al actualizar la URL.');
    }
    const widgetEl = grid.engine.nodes.find(n => n.id === widgetId)?.el;
    if (!widgetEl) return;
    // Update dataset
    widgetEl.dataset.url = newUrl;
    // Update video stream src
    const video = widgetEl.querySelector('video-stream');
    if (video) {
        video.src = newUrl;
    }
    saveLayout();
    closeModal('edit-camera-modal');
}

function renderGraphWidgetContent(container, entityId) {
    if (!container) return;
    const entity = haStates[entityId];
    const name = (entity && entity.attributes.friendly_name) || entityId;
    const canvasId = `chart-${entityId}`;
    container.innerHTML = `
        <div class="entity-name">${name}</div>
        <div class="entity-state" id="state-graph-${entityId}" style="font-size: 20px; font-weight: 500;">...</div>
        <div class="chart-container" style="position: relative; flex-grow: 1; width: 100%; min-height: 0;">
            <canvas id="${canvasId}"></canvas>
        </div>
    `;
    updateWidgetUI(entityId);
    fetchHistoryAndRenderChart(entityId, canvasId);
}

function simplifyData(data, maxPoints = 200) {
    if (data.length <= maxPoints) {
        return data;
    }
    const simplified = [];
    const step = Math.floor(data.length / maxPoints);
    for (let i = 0; i < data.length; i += step) {
        simplified.push(data[i]);
    }
    return simplified;
}


function fetchHistoryAndRenderChart(entityId, canvasId) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 1); // Últimas 24 horas
    const historyId = messageId++;
    haSocket.send(JSON.stringify({
        id: historyId,
        type: 'history/history_during_period',
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        entity_ids: [entityId]
    }));
    const onHistoryResult = (e) => {
        const data = JSON.parse(e.data);
        if (data.id === historyId) {
            haSocket.removeEventListener('message', onHistoryResult);
            const history = data.result[entityId];
            const canvas = document.getElementById(canvasId);
            const ctx = canvas?.getContext('2d');

            if (!ctx) return;

            if (chartInstances[canvasId]) {
                chartInstances[canvasId].destroy();
            }

            if (!history || history.length === 0) {
                const container = canvas.parentElement;
                if (container) {
                    container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 20px;">No historical data available for this entity.</p>';
                }
                return;
            }

            const rawChartData = history.map(item => ({
                x: new Date(item.lu ? item.lu * 1000 : item.last_changed),
                y: parseFloat(item.s !== undefined ? item.s : item.state)
            })).filter(item => !isNaN(item.y));
            
            const chartData = simplifyData(rawChartData);

            if (chartData.length === 0) {
                const container = canvas.parentElement;
                if (container) {
                    container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 20px;">Historical data is not numeric and cannot be displayed.</p>';
                }
                return;
            }

            chartInstances[canvasId] = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: haStates[entityId]?.attributes.friendly_name || entityId,
                        data: chartData,
                        borderColor: 'rgba(75, 192, 192, 1)',
                        tension: 0.1,
                        pointRadius: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'hour'
                            }
                        },
                        y: {
                            beginAtZero: true
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });
        }
    };
    haSocket.addEventListener('message', onHistoryResult);
}