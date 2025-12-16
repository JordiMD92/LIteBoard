// weather.js

let weatherIntervals = {}; // Para gestionar los relojes de cada widget

function renderWeatherWidgetContent(container, entityId) {
    if (!container) return;

    // Limpiamos intervalos previos si existían para este widget
    if (weatherIntervals[entityId]) clearInterval(weatherIntervals[entityId]);

    container.innerHTML = `
        <div class="weather-widget">
            <div class="weather-header">
                <div class="weather-main-icon" id="weather-icon-${entityId}"></div>
                <div class="weather-header-info">
                    <div class="weather-summary" id="weather-summary-${entityId}">Cargando...</div>
                    <div class="weather-clock" id="weather-clock-${entityId}">--:--</div>
                    <div class="weather-date" id="weather-date-${entityId}">--/--/----</div>
                </div>
            </div>
            
            <div class="weather-forecast-list" id="weather-forecast-${entityId}">
                </div>
        </div>
    `;

    // Iniciar el reloj
    startWeatherClock(entityId);
    
    // Iniciar datos de HA
    updateWeatherWidgetUI(entityId);
}

function startWeatherClock(entityId) {
    const updateTime = () => {
        const now = new Date();
        const clockEl = document.getElementById(`weather-clock-${entityId}`);
        const dateEl = document.getElementById(`weather-date-${entityId}`);
        
        if (clockEl) {
            // Formato HH:MM
            clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        if (dateEl) {
            // Formato DD/MM/YYYY
            dateEl.innerText = now.toLocaleDateString();
        }
    };
    
    updateTime(); // Ejecutar inmediatamente
    weatherIntervals[entityId] = setInterval(updateTime, 1000); // Actualizar cada segundo
}

async function updateWeatherWidgetUI(entityId) {
    const entity = haStates[entityId];
    if (!entity) return;

    const iconEl = document.getElementById(`weather-icon-${entityId}`);
    const summaryEl = document.getElementById(`weather-summary-${entityId}`);
    const forecastEl = document.getElementById(`weather-forecast-${entityId}`);

    // Actualizar Estado y Temperatura actual (ej: "Lluvioso, 12°C")
    if (summaryEl) {
        const stateTranslate = translateState(entity.state);
        const temp = entity.attributes.temperature;
        summaryEl.innerText = `${stateTranslate}, ${temp}°C`;
    }

    // Actualizar Icono Principal
    if (iconEl) {
        const icon = getWeatherIcon(entity.state);
        iconEl.innerHTML = icon;
    }

    // Actualizar Pronóstico
    if (forecastEl) {
        try {
            // Llamada al servicio para obtener pronóstico por horas (o diario si está disponible directamente)
            // Nota: Home Assistant cambió recientemente a get_forecasts. Usamos hourly y lo procesamos.
            const forecastData = await callServiceWithResult('weather', 'get_forecasts', { entity_id: entityId }, { type: 'daily' });
            
            if (!forecastData || !forecastData.response || !forecastData.response[entityId]) {
                 console.warn("No forecast data found");
                 return;
            }

            const dailyForecasts = forecastData.response[entityId].forecast.slice(0, 7);
            
            
            
            // Calcular Min y Max globales de los próximos 5 días para escalar las barras
            let globalMin = 100;
            let globalMax = -100;
            dailyForecasts.forEach(day => {
                if (day.templow < globalMin) globalMin = day.templow;
                if (day.temperature > globalMax) globalMax = day.temperature;
            });
            // Añadimos un pequeño margen visual
            globalMin -= 2; 
            globalMax += 2;
            const totalRange = globalMax - globalMin;

            let forecastHTML = '';
            const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

            dailyForecasts.forEach(day => {
                const dateObj = new Date(day.datetime); // day.date viene del procesador
                const dayName = dayNames[dateObj.getDay()];
                const icon = getWeatherIcon(day.condition);
                
                // Cálculos para la barra
                const leftPercent = ((day.templow - globalMin) / totalRange) * 100;
                const widthPercent = ((day.temperature - day.templow) / totalRange) * 100;
                
                // Color dinámico de la barra (Gradiante Teal -> Yellow similar a la imagen)
                const barGradient = 'linear-gradient(90deg, #7FDBB0 0%, #E8F596 100%)'; 

                forecastHTML += `
                    <div class="forecast-row">
                        <div class="row-day">${dayName}</div>
                        <div class="row-icon">${icon}</div>
                        <div class="row-temp-min">${day.templow}°C</div>
                        <div class="row-bar-container">
                            <div class="row-bar-fill" style="left: ${leftPercent}%; width: ${widthPercent}%; background: ${barGradient};"></div>
                        </div>
                        <div class="row-temp-max">${day.temperature}°C</div>
                    </div>
                `;
            });
            forecastEl.innerHTML = forecastHTML;

        } catch (error) {
            console.error('Error getting forecast:', error);
            forecastEl.innerHTML = '<div style="text-align:center; opacity:0.5;">Error cargando pronóstico</div>';
        }
    }
}

// Mapeo simple de condiciones a español (puedes ampliarlo)
function translateState(state) {
    const map = {
        'clear-night': 'Despejado',
        'cloudy': 'Nublado',
        'fog': 'Niebla',
        'hail': 'Granizo',
        'lightning': 'Tormenta',
        'lightning-rainy': 'Tormenta',
        'partlycloudy': 'Parcialmente nublado',
        'pouring': 'Lluvia intensa',
        'rainy': 'Lluvioso',
        'snowy': 'Nieve',
        'snowy-rainy': 'Aguanieve',
        'sunny': 'Soleado',
        'windy': 'Ventoso',
        'windy-variant': 'Ventoso'
    };
    return map[state] || state;
}

// Procesar datos horarios para sacar resumen diario (Min/Max/Condición dominante)
function processHourlyForecast(hourly) {
    const daily = {};

    hourly.forEach(hour => {
        const d = new Date(hour.datetime);
        const dateKey = d.toDateString(); // Agrupa por día
        if (!daily[dateKey]) {
            daily[dateKey] = {
                date: d, // Guardamos objeto fecha para sacar el nombre del día luego
                temps: [],
                conditions: [],
            };
        }
        daily[dateKey].temps.push(hour.temperature);
        daily[dateKey].conditions.push(hour.condition);
    });

    return Object.keys(daily).map(k => {
        const day = daily[k];
        const minTemp = Math.round(Math.min(...day.temps));
        const maxTemp = Math.round(Math.max(...day.temps));
        // Condición más frecuente
        const condition = day.conditions.sort((a, b) => 
            day.conditions.filter(v => v === a).length - day.conditions.filter(v => v === b).length
        ).pop();
        return { date: day.date, minTemp, maxTemp, condition };
    });
}

function getWeatherIcon(condition) {
    // Asegúrate de que los nombres coincidan con tus archivos en /icons
    const iconMap = {
        'clear-night': 'night.svg',
        'cloudy': 'cloudy.svg',
        'exceptional': 'day.svg',
        'fog': 'cloudy.svg',
        'hail': 'rainy-7.svg',
        'lightning': 'thunder.svg',
        'lightning-rainy': 'thunder.svg',
        'partlycloudy': 'cloudy-day-2.svg',
        'pouring': 'rainy-6.svg',
        'rainy': 'rainy-5.svg',
        'snowy': 'snowy-6.svg',
        'snowy-rainy': 'snowy-4.svg',
        'sunny': 'day.svg',
        'windy': 'cloudy.svg',
        'windy-variant': 'cloudy.svg',
    };

    const iconName = iconMap[condition] || 'weather.svg';
    return `<img src="icons/${iconName}" alt="${condition}" />`;
}