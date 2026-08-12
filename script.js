// ========================================
// PASTURE TRACKING MAP
// ========================================

// SHF coordinates
const farmLocation = [42.001472, -73.639056];

// ----------------------------------------
// BASE MAPS
// ----------------------------------------

// Standard street map
const streetMap = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        attribution: '&copy; OpenStreetMap contributors'
    }
);

// Topographic / terrain map
const terrainMap = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    {
        maxZoom: 17,
        attribution:
            'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    }
);

// ----------------------------------------
// CREATE MAP
// ----------------------------------------

const map = L.map('map', {
    center: farmLocation,
    zoom: 16,
    layers: [terrainMap]
});

// ----------------------------------------
// MAP LAYER SWITCHER
// ----------------------------------------

const baseMaps = {
    "Terrain": terrainMap,
    "Street Map": streetMap
};

L.control.layers(baseMaps).addTo(map);

// ----------------------------------------
// FARM LOCATION MARKER
// ----------------------------------------

const farmMarker = L.marker(farmLocation).addTo(map);

farmMarker.bindPopup(`
    <strong>Home Farm</strong><br>
    Pasture Tracking Map
`).openPopup();
