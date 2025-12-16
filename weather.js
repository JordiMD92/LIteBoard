
function renderWeatherWidgetContent(container, entityId) {
    if (!container) return;

    container.innerHTML = `
        <div class="weather-widget">
            <div class="current-weather">
                <div class="weather-icon" id="weather-icon-${entityId}"></div>
                <div class="weather-info">
                    <div class="weather-state" id="weather-state-${entityId}"></div>
                    <div class="weather-temp" id="weather-temp-${entityId}"></div>
                </div>
            </div>
            <div class="weather-forecast" id="weather-forecast-${entityId}"></div>
        </div>
    `;

    updateWeatherWidgetUI(entityId);
}

async function updateWeatherWidgetUI(entityId) {
    const entity = haStates[entityId];
    if (!entity) return;

    const iconEl = document.getElementById(`weather-icon-${entityId}`);
    const stateEl = document.getElementById(`weather-state-${entityId}`);
    const tempEl = document.getElementById(`weather-temp-${entityId}`);
    const forecastEl = document.getElementById(`weather-forecast-${entityId}`);

    if (stateEl) {
        stateEl.innerText = entity.state;
    }

    if (tempEl) {
        tempEl.innerText = `${entity.attributes.temperature} ${entity.attributes.temperature_unit}`;
    }

    if (iconEl) {
        const icon = getWeatherIcon(entity.state);
        iconEl.innerHTML = icon;
    }

    if (forecastEl) {
        try {
            const forecastData = await callServiceWithResult('weather', 'get_forecasts', { entity_id: entityId }, { type: 'hourly' });
            const dailyForecasts = processHourlyForecast(forecastData.response[entityId].forecast);
            
            let forecastHTML = '';
            dailyForecasts.slice(0, 5).forEach(day => {
                const icon = getWeatherIcon(day.condition);
                const avgTemp = (day.minTemp + day.maxTemp) / 2;
                const tempColor = getTemperatureColor(avgTemp);

                forecastHTML += `
                    <div class="forecast-day">
                        <div class="forecast-icon">${icon}</div>
                        <div class="forecast-temp">${day.maxTemp}° / ${day.minTemp}°</div>
                        <div class="temp-range-line" style="background-color: ${tempColor};"></div>
                    </div>
                `;
            });
            forecastEl.innerHTML = forecastHTML;
            forecastEl.style.display = 'flex';
        } catch (error) {
            console.error('Error getting forecast:', error);
            forecastEl.style.display = 'none';
        }
    }
}

function getTemperatureColor(temp) {
    // Map temperature (e.g., 0-30°C) to HSL hue (240-360/0)
    const minTemp = 0;
    const maxTemp = 30;
    const minHue = 240; // Blue
    const maxHue = 360; // Red

    const tempPercent = (Math.max(minTemp, Math.min(temp, maxTemp)) - minTemp) / (maxTemp - minTemp);
    const hue = minHue + (tempPercent * (maxHue - minHue));

    return `hsl(${hue}, 80%, 50%)`;
}

function processHourlyForecast(hourly) {
    const daily = {};

    hourly.forEach(hour => {
        const date = new Date(hour.datetime).toLocaleDateString();
        if (!daily[date]) {
            daily[date] = {
                temps: [],
                conditions: [],
            };
        }
        daily[date].temps.push(hour.temperature);
        daily[date].conditions.push(hour.condition);
    });

    return Object.keys(daily).map(date => {
        const day = daily[date];
        const minTemp = Math.round(Math.min(...day.temps));
        const maxTemp = Math.round(Math.max(...day.temps));
        const condition = day.conditions.sort((a, b) => day.conditions.filter(v => v === a).length - day.conditions.filter(v => v === b).length).pop();
        return { minTemp, maxTemp, condition };
    });
}

function getWeatherIcon(condition) {
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
    return `<img src="icons/${iconName}" />`;
}
